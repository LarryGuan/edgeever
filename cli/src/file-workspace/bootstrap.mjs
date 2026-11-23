import { readdir, readFile as readFileAbsolute } from 'node:fs/promises';
import { join, posix } from 'node:path';
import { createNotebook } from '../notebooks.mjs';
import { link, importFile, sync } from './core.mjs';
import { loadState, saveState } from './state.mjs';
import { decodeNote } from './metadata.mjs';
import { atomic, hash, read, safePath } from './files.mjs';
import { listActiveMemos } from './remote.mjs';

async function scanIncluded(root, includes) {
  const files = [], directories = new Set(), ignoredPaths = new Set(), excluded = { d2: 0, hidden: 0, other: 0 }, issues = [];
  async function walk(dir) {
    let entries;
    try { entries = await readdir(await safePath(root, dir), { withFileTypes: true }); }
    catch (error) { issues.push({ path: dir, status: 'scan-error', error: error.message }); return; }
    for (const item of entries) {
      const path = posix.join(dir, item.name);
      if (item.isSymbolicLink()) { issues.push({ path, status: 'symlink-unsupported' }); continue; }
      if (item.name.startsWith('.') || item.name === '99_temp' || item.name === '.edgeever') { excluded.hidden++; ignoredPaths.add(path); continue; }
      if (item.isDirectory()) { await walk(path); continue; }
      if (/\.md$/i.test(path)) { files.push(path); directories.add(posix.dirname(path)); }
      else if (/\.d2$/i.test(path)) excluded.d2++;
      else excluded.other++;
    }
  }
  for (const include of includes) {
    directories.add(include);
    await walk(include);
  }
  for (const file of files) {
    let directory = posix.dirname(file);
    while (directory && directory !== '.') {
      directories.add(directory);
      if (includes.includes(directory)) break;
      directory = posix.dirname(directory);
    }
  }
  return { files: files.sort(), directories: [...directories].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b)), ignoredPaths: [...ignoredPaths], excluded, issues };
}

function notebookPaths(notebooks) {
  const map = new Map(notebooks.map(notebook => [notebook.id, notebook]));
  const paths = new Map();
  function pathOf(id, seen = new Set()) {
    if (paths.has(id)) return paths.get(id);
    if (seen.has(id)) throw Error('Notebook cycle');
    seen.add(id);
    const notebook = map.get(id); if (!notebook) return null;
    const path = notebook.parentId ? posix.join(pathOf(notebook.parentId, seen), notebook.name) : notebook.name;
    paths.set(id, path); return path;
  }
  for (const notebook of notebooks) pathOf(notebook.id);
  return { byId: paths, byPath: new Map([...paths].map(([id, path]) => [path, id])) };
}

async function readMapping(path) {
  if (!path) return {};
  const mapping = JSON.parse(await readFileAbsolute(path, 'utf8'));
  if (mapping?.version !== 1 || !mapping.items || typeof mapping.items !== 'object') throw Error('Bootstrap mapping must contain version: 1 and an items object');
  for (const [file, item] of Object.entries(mapping.items)) {
    if (!['bind','create','skip'].includes(item?.action)) throw Error(`Invalid bootstrap mapping action for ${file}`);
    if (item.action === 'bind' && typeof item.memoId !== 'string') throw Error(`Bootstrap bind requires memoId for ${file}`);
  }
  return mapping.items;
}

export async function bootstrapWorkspace(root, client, { include = [], mappingPath, run = false, journalDirectory } = {}) {
  if (!include.length) throw Error('workspace bootstrap requires --include <dir1,dir2>');
  for (const path of include) if (!path || posix.isAbsolute(path) || posix.normalize(path) !== path || path.split('/').some(part => part === '..' || part.startsWith('.'))) throw Error(`Invalid bootstrap include: ${path}`);
  const mapping = await readMapping(mappingPath);
  const scan = await scanIncluded(root, include);
  const remote = await client.request('/api/v1/notebooks');
  const memos = await listActiveMemos(client);
  const titles = new Map();
  for (const memo of memos) {
    const key = memo.title || 'untitled';
    titles.set(key, [...(titles.get(key) || []), { id: memo.id, notebookId: memo.notebookId, title: memo.title }]);
  }
  const existingPaths = notebookPaths(remote.notebooks);
  const items = [];
  for (const path of scan.files) {
    const raw = await read(root, path);
    const decoded = decodeNote(raw);
    const title = posix.basename(path, posix.extname(path));
    const configured = mapping[path];
    let action = configured?.action;
    const candidates = titles.get(title) || [];
    if (decoded.id) action = 'tracked';
    else if (!action) action = candidates.length ? 'candidate-existing' : 'create';
    items.push({ path, directory: posix.dirname(path), title, action, ...(configured?.memoId ? { memoId: configured.memoId } : {}), ...(candidates.length ? { candidates } : {}) });
  }
  const preview = {
    run,
    status: run ? 'running' : 'preview',
    include,
    files: items.length,
    directories: scan.directories.length,
    excluded: scan.excluded,
    issues: scan.issues,
    items,
    existingNotebookPaths: Object.fromEntries(scan.directories.filter(path => existingPaths.byPath.has(path)).map(path => [path, existingPaths.byPath.get(path)])),
  };
  if (!run) return preview;

  const manifestId = hash(JSON.stringify({ include, files: items.map(item => item.path) })).slice(0, 16);
  const manifestPath = `.edgeever/bootstrap/${manifestId}.json`;
  let manifest = {
    version: 1,
    id: manifestId,
    status: 'running',
    startedAt: new Date().toISOString(),
    include,
    notebooks: {},
    items: Object.fromEntries(items.map(item => [item.path, { action: item.action, status: 'pending', ...(item.memoId ? { memoId: item.memoId } : {}) }])),
  };
  const savedManifest = await read(root, manifestPath);
  if (savedManifest !== null) {
    try { manifest = { ...manifest, ...JSON.parse(savedManifest), status: 'running', resumedAt: new Date().toISOString() }; }
    catch { throw Error(`Bootstrap manifest is invalid: ${manifestPath}`); }
  }
  const saveManifest = () => atomic(root, manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await saveManifest();

  const directoryIds = new Map();
  for (const path of scan.directories) {
    const existingNotebookId = existingPaths.byPath.get(path);
    if (existingNotebookId) {
      directoryIds.set(path, existingNotebookId);
      manifest.notebooks[path] = { status: 'complete', notebookId: existingNotebookId, reused: true };
      continue;
    }
    const result = await createNotebook(client, { path, parents: true }, journalDirectory || join(root, '.edgeever', 'bootstrap', 'notebook-operations'));
    if (result.status !== 'complete') {
      manifest.status = result.status === 'uncertain' ? 'stopped-uncertain' : 'partial';
      manifest.notebooks[path] = { status: result.status, error: result.message || result.status };
      await saveManifest();
      return { ...preview, status: 'partial', stoppedAt: { phase: 'notebook', path, status: result.status }, manifest: manifestPath };
    }
    directoryIds.set(path, result.notebookId);
    manifest.notebooks[path] = { status: 'complete', notebookId: result.notebookId };
    await saveManifest();
  }
  const rootIds = [...new Set(include.map(path => directoryIds.get(path)).filter(Boolean))];
  if (rootIds.length !== include.length) throw Error('One or more included roots contain no Markdown files or could not be created');
  let scope = { all: false, include: rootIds, exclude: [], recursive: true };
  let replace = false;
  try {
    const state = await loadState(root); replace = true;
    if (state.scope?.all) scope = state.scope;
    else scope.include = [...new Set([...(state.scope?.include || []), ...rootIds])];
  } catch (error) { if (!/Not linked/.test(error.message)) throw error; }
  await link(root, client, scope, replace);
  const linkedState = await loadState(root);
  linkedState.ignorePaths = [...new Set([...(linkedState.ignorePaths || []), ...scan.ignoredPaths, '.git', '.obsidian', '.claude', '.claudian', '99_temp', 'AGENT.md', 'README.md'])];
  await saveState(root, linkedState);

  const results = [];
  let pendingAttachments = 0;
  let stoppedAt;
  for (const item of items) {
    if (item.action === 'tracked') { results.push({ path: item.path, status: 'already-tracked' }); manifest.items[item.path] = { action: item.action, status: 'already-tracked' }; await saveManifest(); continue; }
    if (item.action === 'skip') { results.push({ path: item.path, status: 'skipped' }); manifest.items[item.path] = { action: item.action, status: 'skipped' }; await saveManifest(); continue; }
    if (item.action === 'candidate-existing') { results.push({ path: item.path, status: 'candidate-existing', candidates: item.candidates }); manifest.items[item.path] = { action: item.action, status: 'candidate-existing' }; await saveManifest(); continue; }
    try {
      const result = await importFile(root, client, { file: item.path, notebookId: directoryIds.get(item.directory), title: item.title, memoId: item.action === 'bind' ? item.memoId : undefined });
      pendingAttachments += result.pendingAttachments || 0;
      results.push(result);
      manifest.items[item.path] = { action: item.action, status: result.status, memoId: result.id };
    } catch (error) {
      const uncertain = !Number.isInteger(error.status) && /uncertain|response|network|fetch|socket|timeout|econn/i.test(error.message);
      results.push({ path: item.path, status: uncertain ? 'uncertain' : 'error', error: error.message });
      manifest.items[item.path] = { action: item.action, status: uncertain ? 'uncertain' : 'error', error: error.message };
      if (uncertain) stoppedAt = { phase: 'memo', path: item.path, status: 'uncertain' };
    }
    await saveManifest();
    if (stoppedAt) break;
  }
  let attachmentSync;
  if (!stoppedAt && pendingAttachments) {
    try { attachmentSync = await sync(root, client); }
    catch (error) {
      stoppedAt = { phase: 'attachment', status: 'uncertain', error: error.message };
      manifest.attachmentSync = { status: 'uncertain', error: error.message };
    }
  }
  const status = stoppedAt || results.some(result => ['error','uncertain','candidate-existing'].includes(result.status)) ? 'partial' : 'complete';
  manifest.status = status;
  manifest.completedAt = new Date().toISOString();
  manifest.pendingAttachments = pendingAttachments;
  if (stoppedAt) manifest.stoppedAt = stoppedAt;
  await saveManifest();
  return { ...preview, status, roots: rootIds, results, pendingAttachments, attachmentSync, manifest: manifestPath, ...(stoppedAt ? { stoppedAt } : {}) };
}
