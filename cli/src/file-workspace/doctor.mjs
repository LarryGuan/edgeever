import { readdir, stat } from 'node:fs/promises';
import { posix } from 'node:path';
import { loadState } from './state.mjs';
import { hash, read, safePath } from './files.mjs';
import { scanNotes } from './layout.mjs';
import { decodeNote } from './metadata.mjs';
import { markdownUrls, normalizeRemote } from './attachments.mjs';

async function walk(root, dir = '', ignored = []) {
  const files = [];
  for (const item of await readdir(await safePath(root, dir), { withFileTypes: true })) {
    if (item.name === '.edgeever' || item.name === '.git') continue;
    const path = posix.join(dir, item.name);
    if (ignored.some(value => path === value || path.startsWith(`${value}/`))) continue;
    if (item.isSymbolicLink()) { files.push({ path, kind: 'symlink' }); continue; }
    if (item.isDirectory()) files.push(...await walk(root, path, ignored));
    else files.push({ path, kind: 'file' });
  }
  return files;
}

const isExternal = url => /^(?:https?:|mailto:|data:|#|\/\/)/i.test(url) || /^[a-z][a-z\d+.-]*:/i.test(url) || url.startsWith('/');

async function markdownDiagnostics(root, path, issues) {
  const raw = await read(root, path);
  if (raw === null) return;
  let body;
  try { ({ body } = decodeNote(raw)); }
  catch (error) { issues.push({ path, status: 'metadata-error', error: error.message }); return; }
  if (/\[\[[^\]]+\]\]/.test(body)) issues.push({ path, status: 'inter-note-link', kind: 'wiki', next: 'Review cloud navigation; links are preserved but not rewritten' });
  for (const ref of markdownUrls(body)) {
    if (isExternal(ref.url)) continue;
    const clean = ref.url.split('#')[0];
    if (!clean) continue;
    let decoded;
    try { decoded = decodeURIComponent(clean); }
    catch { issues.push({ path, status: 'invalid-link', link: ref.url }); continue; }
    const target = posix.normalize(posix.join(posix.dirname(path), decoded));
    if (/\.md$/i.test(target)) {
      issues.push({ path, status: 'inter-note-link', kind: 'markdown', link: ref.url, next: 'Review cloud navigation; links are preserved but not rewritten' });
      continue;
    }
    try { if (!(await stat(await safePath(root, target))).isFile()) issues.push({ path, status: 'missing-attachment', link: ref.url }); }
    catch (error) { if (error.code === 'ENOENT') issues.push({ path, status: 'missing-attachment', link: ref.url }); else issues.push({ path, status: 'attachment-error', link: ref.url, error: error.message }); }
  }
}

export async function doctorWorkspace(root, client) {
  const issues = [];
  let state;
  try { state = await loadState(root); }
  catch (error) {
    const files = await walk(root, '', ['.git','.edgeever','.obsidian','.claude','.claudian','99_temp']);
    for (const file of files) if (/\.md$/i.test(file.path)) await markdownDiagnostics(root, file.path, issues);
    issues.push({ status: /Not linked/.test(error.message) ? 'workspace-unlinked' : 'state-error', error: error.message });
    return { ok: false, linked: false, issues, counts: summarize(issues) };
  }
  const files = await walk(root, '', state.ignorePaths || []);
  for (const file of files) {
    if (file.kind === 'symlink') issues.push({ path: file.path, status: 'symlink-unsupported' });
    else if (/\.d2$/i.test(file.path)) issues.push({ path: file.path, status: 'd2-unsupported' });
    else if (/\.md$/i.test(file.path)) await markdownDiagnostics(root, file.path, issues);
  }

  if (state.url !== client.baseUrl) throw Error('Server/workspace mismatch. Refusing to mix accounts.');
  const info = await client.request('/api/v1/file-workspace');
  if (info.workspaceId !== state.workspaceId) throw Error('Server/workspace mismatch. Refusing to mix accounts.');

  const scan = await scanNotes(root, state);
  issues.push(...scan.problems);
  const { notebooks } = await client.request('/api/v1/notebooks');
  const notebookMap = new Map(notebooks.map(notebook => [notebook.id, notebook]));
  for (const [id, entry] of Object.entries(state.entries)) {
    let memo;
    try { ({ memo } = await client.request(`/api/v1/memos/${encodeURIComponent(id)}?includeDeleted=1`)); }
    catch (error) {
      issues.push({ id, path: entry.path, status: error.status === 404 ? 'remote-missing' : 'remote-error', error: error.message });
      continue;
    }
    if (memo.isDeleted) { issues.push({ id, path: entry.path, status: 'remote-trashed' }); continue; }
    if (memo.document?.storageMode === 'resource') issues.push({ id, path: entry.path, status: 'file-note-unsupported', formatKey: memo.document.formatKey });
    if (memo.notebookId !== entry.notebookId) issues.push({ id, path: entry.path, status: 'notebook-drift', localNotebookId: entry.notebookId, remoteNotebookId: memo.notebookId, remoteNotebook: notebookMap.get(memo.notebookId)?.name });
    const localTitle = posix.basename(entry.path, posix.extname(entry.path));
    if ((memo.title || 'untitled') !== localTitle) issues.push({ id, path: entry.path, status: 'title-drift', localTitle, remoteTitle: memo.title });
    const serverHash = entry.serverHash ?? hash(entry.serverBase ?? entry.base);
    if (memo.revision !== entry.revision || hash(memo.contentMarkdown) !== serverHash) issues.push({ id, path: entry.path, status: 'remote-changed', localRevision: entry.revision, remoteRevision: memo.revision });
    try { await normalizeRemote(entry.serverBase ?? entry.base, state.url); }
    catch (error) { issues.push({ id, path: entry.path, status: 'baseline-error', error: error.message }); }
  }
  return { ok: issues.length === 0, linked: true, workspaceId: state.workspaceId, notes: Object.keys(state.entries).length, issues, counts: summarize(issues) };
}

function summarize(issues) {
  return Object.fromEntries([...new Set(issues.map(issue => issue.status))].sort().map(status => [status, issues.filter(issue => issue.status === status).length]));
}
