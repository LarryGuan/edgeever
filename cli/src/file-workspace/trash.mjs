import { mkdir, open, rename, unlink } from 'node:fs/promises';
import { posix } from 'node:path';
import { loadState, saveState } from './state.mjs';
import { atomic, hash, read, safePath } from './files.mjs';
import { scanNotes } from './layout.mjs';

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

export async function trashMemo(root, client, memoId, { run = false, force = false } = {}) {
  if (!memoId) throw Error('workspace trash requires --memo <id>');
  return locked(root, async () => {
    const state = await loadState(root);
    const entry = state.entries[memoId];
    if (!entry) throw Error(`Memo is not tracked in this workspace: ${memoId}`);
    if (state.url !== client.baseUrl) throw Error('Server/workspace mismatch. Refusing to mix accounts.');

    let memo;
    try { ({ memo } = await client.request(`/api/v1/memos/${encodeURIComponent(memoId)}?includeDeleted=1`)); }
    catch (error) {
      if (error.status === 404) return { id: memoId, path: entry.path, status: 'remote-missing', run: false };
      throw error;
    }
    if (!memo || typeof memo.contentMarkdown !== 'string' || !Number.isInteger(memo.revision)) throw Error('Invalid memo response');

    const remoteChanged = memo.revision !== entry.revision || hash(memo.contentMarkdown) !== (entry.serverHash ?? hash(entry.serverBase ?? entry.base));
    if (!memo.isDeleted && remoteChanged && !force) {
      return { id: memoId, path: entry.path, status: 'remote-changed', run: false, requiresForce: true, localRevision: entry.revision, remoteRevision: memo.revision };
    }
    if (!run) return { id: memoId, path: entry.path, status: memo.isDeleted ? 'already-trashed' : 'would-trash', run: false, remoteChanged };

    if (!memo.isDeleted) await client.request(`/api/v1/memos/${encodeURIComponent(memoId)}`, { method: 'DELETE' });

    const scan = await scanNotes(root, state);
    const located = scan.ids.get(memoId)?.length === 1 ? scan.ids.get(memoId)[0].path : entry.path;
    const raw = await read(root, located);
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const directory = `.edgeever/history/trash/${stamp}-${hash(memoId).slice(0, 12)}`;
    if (raw !== null) {
      const target = posix.join(directory, 'note.md');
      await mkdir(posix.dirname(await safePath(root, target)), { recursive: true, mode: 0o700 });
      await rename(await safePath(root, located), await safePath(root, target));
    }
    await atomic(root, posix.join(directory, 'record.json'), JSON.stringify({
      memoId,
      path: located,
      title: memo.title,
      notebookId: memo.notebookId,
      localRevision: entry.revision,
      remoteRevision: memo.revision,
      remoteChanged,
      trashedAt: new Date().toISOString(),
      localCopy: raw === null ? null : posix.join(directory, 'note.md'),
    }, null, 2) + '\n');

    delete state.entries[memoId];
    if (state.conflicts) delete state.conflicts[memoId];
    if (state.resources) for (const [key, resource] of Object.entries(state.resources)) if (resource.memoId === memoId) delete state.resources[key];
    await saveState(root, state);
    return { id: memoId, path: located, status: memo.isDeleted ? 'retired-already-trashed' : 'trashed', run: true, remoteChanged, history: directory };
  });
}
