import { readdir } from 'node:fs/promises';
import { posix } from 'node:path';
import { safePath, safeName, read } from './files.mjs';
import { decodeNote } from './metadata.mjs';

export async function scanNotes(root, state) {
  const files = new Map(), ids = new Map(), problems = [];
  const ignored = state.ignorePaths || [];
  const isIgnored = path => ignored.some(value => path === value || path.startsWith(`${value}/`));
  async function walk(dir = '') {
    for (const item of await readdir(await safePath(root, dir), { withFileTypes: true })) {
      if (item.name === '.edgeever') continue;
      const path = posix.join(dir, item.name);
      if (isIgnored(path)) continue;
      if (item.isSymbolicLink()) throw Error(`Symlink is not allowed: ${path}`);
      if (item.isDirectory()) await walk(path);
      else if (/\.md$/i.test(path)) {
        const raw = await read(root, path);
        try {
          const note = { path, id:decodeNote(raw).id }; files.set(path, note);
          if (note.id) ids.set(note.id, [...(ids.get(note.id) || []), note]);
        } catch (error) { files.set(path, { path, error: error.message }); }
      }
    }
  }
  await walk();
  const blocked = new Map();
  const block = (id, problem) => { if (!blocked.has(id)) { blocked.set(id, problem); problems.push({ id, ...problem }); } };
  for (const [id, notes] of ids) {
    if (notes.length > 1) block(id, { status: 'duplicate-id', paths: notes.map(n => n.path) });
    else if (!state.entries[id]) block(id, { status: 'unbound-id', path: notes[0].path });
  }
  for (const [id, entry] of Object.entries(state.entries)) {
    await safePath(root, entry.path);
    const atPath = files.get(entry.path);
    if (atPath && atPath.id !== id) {
      // A file replaced at the tracked path must not be silently reassigned.
      block(id, { status: atPath.error ? 'metadata-error' : 'identity-mismatch', path: entry.path, error: atPath.error });
      if (atPath.id) block(atPath.id, { status: 'identity-mismatch', path: entry.path });
    } else if (!ids.has(id)) block(id, { status: 'missing-local', path: entry.path });
  }
  for (const note of files.values()) {
    if (note.error && !Object.values(state.entries).some(e => e.path === note.path)) problems.push({ path: note.path, status: 'metadata-error', error: note.error });
    else if (!note.id && !note.error && !Object.values(state.entries).some(e => e.path === note.path)) problems.push({ path: note.path, status: 'untracked' });
  }
  return { files, ids, blocked, problems };
}

// Case-insensitive reservations make generated names portable to Windows/macOS.
export async function availablePath(root, desired, reserved = new Set(), directory = false) {
  const parent = posix.dirname(desired), name = posix.basename(desired);
  const ext = directory ? '' : posix.extname(name), stem = ext ? name.slice(0, -ext.length) : name;
  const names = new Set();
  try { for (const item of await readdir(await safePath(root, parent))) names.add(item.toLowerCase()); }
  catch (e) { if (e.code !== 'ENOENT') throw e; }
  for (let n = 1; n < 10000; n++) {
    const candidate = n === 1 ? name : `${stem} (${n})${ext}`;
    const path = posix.join(parent, candidate);
    if (!names.has(candidate.toLowerCase()) && !reserved.has(path.toLowerCase())) { reserved.add(path.toLowerCase()); return path; }
  }
  throw Error(`Too many path collisions: ${desired}`);
}

export async function notebookDirectory(root, id, notebooks, state, reserved = new Set()) {
  state.notebookPaths ??= {};
  const map = new Map(notebooks.map(n => [n.id, n]));
  const seen = new Set();
  async function directory(id) {
    if (state.directoryBindings?.[id] !== undefined) {
      const bound=state.directoryBindings[id];
      if(typeof bound!=='string'||!bound||posix.isAbsolute(bound)||posix.normalize(bound)!==bound||bound.split('/').some(p=>p==='..'||p.toLowerCase()==='.edgeever'))throw Error('Invalid notebook directory binding');
      await safePath(root,bound);state.notebookPaths[id]=bound;return bound;
    }
    if (state.notebookPaths[id] !== undefined) return state.notebookPaths[id];
    if (seen.has(id)) throw Error('Notebook cycle'); seen.add(id);
    const notebook = map.get(id); if (!notebook) throw Error(`Notebook not found: ${id}`);
    const parent = notebook.parentId ? await directory(notebook.parentId) : '';
    const used = new Set([...reserved, ...Object.values(state.notebookPaths).map(p => p.toLowerCase())]);
    const desired = posix.join(parent, safeName(notebook.name));
    const previous=state.layoutPreviousPaths?.[id];
    const path = previous && posix.dirname(previous.path) === (parent || '.') && safeName(previous.name) === safeName(notebook.name) ? previous.path : await availablePath(root, desired, used, true);
    state.notebookPaths[id] = path; return path;
  }
  return directory(id);
}

export function refreshNotebookLayout(state, notebooks) {
  const map = new Map(notebooks.map(n => [n.id,n]));
  const previous = state.notebookShape || {};
  const changed = new Set(state.layoutInvalidated || []);
  for (const [id, shape] of Object.entries(previous)) {
    const current = map.get(id);
    if (current && (shape.name !== current.name || shape.parentId !== current.parentId)) changed.add(id);
  }
  const affected = id => {
    const seen = new Set();
    while (id && !seen.has(id)) { if(changed.has(id)) return true;seen.add(id);id=map.get(id)?.parentId; }
    return false;
  };
  state.retiredNotebookPaths ??= [];
  state.layoutPreviousPaths ??= {};
  for(const [id,path] of Object.entries(state.notebookPaths || {})) if(affected(id)) {
    state.layoutPreviousPaths[id]={path,name:previous[id]?.name || map.get(id)?.name};
    if(path!=='.' && !state.retiredNotebookPaths.includes(path)) state.retiredNotebookPaths.push(path);
    delete state.notebookPaths[id];
  }
  state.notebookShape = Object.fromEntries(notebooks.map(n=>[n.id,{name:n.name,parentId:n.parentId}]));
  delete state.layoutInvalidated;
}

export async function readIdentifiedNote(root, path, id) {
  const raw=await read(root,path);
  if(raw===null)throw Error('Local file disappeared during sync');
  const note=decodeNote(raw);
  if(note.id!==id)throw Error('Local identity changed during sync');
  return {path,raw,...note};
}
