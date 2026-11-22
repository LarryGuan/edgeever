import { mkdir, open, readdir, unlink } from 'node:fs/promises';
import { posix } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadState, saveState } from './state.mjs';
import { atomic, hash, read, safePath } from './files.mjs';
import { decodeNote } from './metadata.mjs';
import { normalizeRemote } from './attachments.mjs';

async function locked(root, fn) {
  await safePath(root);
  await mkdir(await safePath(root, '.edgeever'), { recursive: true, mode: 0o700 });
  const path = await safePath(root, '.edgeever/lock');
  const lock = await open(path, 'wx', 0o600).catch(error => {
    if (error.code === 'EEXIST') throw Error('Workspace is locked. Verify the previous process exited before removing .edgeever/lock.');
    throw error;
  });
  try { return await fn(); }
  finally { await lock.close(); await unlink(path); }
}

async function identifiedMarkdown(root, dir = '') {
  const notes = [];
  for (const item of await readdir(await safePath(root, dir), { withFileTypes: true })) {
    if (item.name === '.edgeever' || item.name === '.git') continue;
    const path = posix.join(dir, item.name);
    if (item.isSymbolicLink()) { notes.push({ path, error: 'Symlink is not allowed' }); continue; }
    if (item.isDirectory()) notes.push(...await identifiedMarkdown(root, path));
    else if (/\.md$/i.test(path)) {
      const raw = await read(root, path);
      try { const decoded = decodeNote(raw); if (decoded.id) notes.push({ path, raw, ...decoded }); }
      catch (error) { notes.push({ path, error: error.message }); }
    }
  }
  return notes;
}

export async function adoptWorkspace(root, client, { run = false } = {}) {
  const execute = async () => {
    try { await loadState(root); throw Error('Workspace is already linked; use workspace doctor instead of adopt.'); }
    catch (error) { if (!/Not linked/.test(error.message)) throw error; }

    const info = await client.request('/api/v1/file-workspace');
    if (info.protocolVersion !== 1 || info.atomicRevisionWrites !== true || info.attachmentSync !== true) throw Error('Server lacks current file-workspace support');
    const { notebooks } = await client.request('/api/v1/notebooks');
    const notebookMap = new Map(notebooks.map(notebook => [notebook.id, notebook]));
    const roots = new Set();
    const rootBindings = {};
    const entries = {};
    const conflicts = {};
    const issues = [];
    const notes = await identifiedMarkdown(root);
    const byId = new Map();
    for (const note of notes) {
      if (note.error) { issues.push({ path: note.path, status: 'metadata-error', error: note.error }); continue; }
      byId.set(note.id, [...(byId.get(note.id) || []), note]);
    }
    for (const [id, matches] of byId) if (matches.length > 1) issues.push({ id, status: 'duplicate-id', paths: matches.map(match => match.path) });

    for (const [id, matches] of byId) {
      if (matches.length !== 1) continue;
      const note = matches[0];
      let memo;
      try { ({ memo } = await client.request(`/api/v1/memos/${encodeURIComponent(id)}?includeDeleted=1`)); }
      catch (error) { issues.push({ id, path: note.path, status: error.status === 404 ? 'remote-missing' : 'remote-error', error: error.message }); continue; }
      if (memo.isDeleted) { issues.push({ id, path: note.path, status: 'remote-trashed' }); continue; }
      if (memo.document?.storageMode === 'resource') { issues.push({ id, path: note.path, status: 'file-note-unsupported' }); continue; }
      let rootId = memo.notebookId, seen = new Set();
      while (notebookMap.get(rootId)?.parentId) {
        if (seen.has(rootId)) throw Error('Notebook cycle');
        seen.add(rootId); rootId = notebookMap.get(rootId).parentId;
      }
      if (!notebookMap.has(rootId)) { issues.push({ id, path: note.path, status: 'notebook-missing', notebookId: memo.notebookId }); continue; }
      roots.add(rootId);
      const localRoot = note.path.split('/')[0];
      if (rootBindings[rootId] && rootBindings[rootId] !== localRoot) issues.push({ id, path: note.path, status: 'root-binding-conflict', notebookId: rootId, paths: [rootBindings[rootId], localRoot] });
      else rootBindings[rootId] = localRoot;

      const same = await normalizeRemote(note.body, client.baseUrl) === await normalizeRemote(memo.contentMarkdown, client.baseUrl);
      entries[id] = {
        localPathOverride: true,
        path: note.path,
        notebookId: memo.notebookId,
        revision: memo.revision,
        base: same ? note.body : memo.contentMarkdown,
        hash: hash(same ? note.body : memo.contentMarkdown),
        serverBase: memo.contentMarkdown,
        serverHash: hash(memo.contentMarkdown),
      };
      if (!same) conflicts[id] = { status: 'adopt-conflict', localPath: note.path, remoteRevision: memo.revision };
    }

    const blocking = issues.filter(issue => ['duplicate-id','metadata-error','remote-missing','remote-error','remote-trashed','file-note-unsupported','notebook-missing','root-binding-conflict'].includes(issue.status));
    const result = { run, status: blocking.length ? 'blocked' : run ? 'adopted' : 'preview', notes: Object.keys(entries).length, roots: [...roots], conflicts: Object.keys(conflicts).length, issues };
    if (!run || blocking.length) return result;
    if (!Object.keys(entries).length) throw Error('No identified Markdown files were found');

    const state = {
      version: 4,
      url: client.baseUrl,
      workspaceId: info.workspaceId,
      scope: { all: false, include: [...roots], exclude: [], recursive: true },
      entries,
      conflicts,
      directoryBindings: rootBindings,
      ignorePaths: ['.git', '.obsidian', '.claude', '.claudian', '99_temp', 'AGENT.md', 'README.md'],
    };
    for (const [id, conflict] of Object.entries(conflicts)) {
      const entry = entries[id], note = byId.get(id)[0];
      const directory = `.edgeever/conflicts/${hash(id)}/${randomUUID()}`;
      await atomic(root, `${directory}/local.md`, note.body);
      await atomic(root, `${directory}/remote.md`, entry.serverBase);
      conflict.localCopy = `${directory}/local.md`;
      conflict.remoteCopy = `${directory}/remote.md`;
    }
    await saveState(root, state);
    return result;
  };
  return run ? locked(root, execute) : execute();
}
