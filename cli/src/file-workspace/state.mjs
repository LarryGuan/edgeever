import { readFileSync, lstatSync } from 'node:fs';
import { posix, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { hash, read, atomic } from './files.mjs';

function baseline(root, ref) {
  if (!/^[a-f0-9]{64}$/.test(ref || '')) throw Error('Invalid baseline reference');
  let path = resolve(root);
  for (const part of ['', '.edgeever', 'baselines', `${ref}.md`]) {
    if (part) path = posix.join(path, part);
    if (lstatSync(path).isSymbolicLink()) throw Error('Baseline symlink is not allowed');
  }
  const body = readFileSync(path, 'utf8');
  if (hash(body) !== ref) throw Error(`Baseline integrity mismatch: ${ref}`);
  return body;
}
function lazy(root, entry, field) {
  const ref = entry[`${field}Ref`];
  Object.defineProperty(entry, field, { configurable: true, enumerable: false,
    get: () => baseline(root, ref),
    set: value => Object.defineProperty(entry, field, { value, writable: true, enumerable: true, configurable: true }),
  });
}
export async function loadState(root) {
  const raw = await read(root, '.edgeever/state.json');
  if (!raw) throw Error('Not linked. Run workspace link first.');
  const state = JSON.parse(raw);
  if (![1,2,3,4].includes(state.version) || !state.entries || !state.scope) throw Error('Unsupported workspace state');
  if (state.version === 4) for (const entry of Object.values(state.entries)) for (const field of ['base','serverBase']) {
    if (typeof entry[`${field}Ref`] !== 'string') throw Error('Missing baseline reference');
    lazy(root, entry, field);
  }
  return state;
}
export async function saveState(root, state) {
  if (state.version !== 4) throw Error('Migrate workspace storage before writing');
  for (const entry of Object.values(state.entries)) for (const field of ['base','serverBase']) {
    const descriptor = Object.getOwnPropertyDescriptor(entry, field);
    if (descriptor && 'value' in descriptor && typeof descriptor.value === 'string') {
      const body = descriptor.value, ref = hash(body), path = `.edgeever/baselines/${ref}.md`;
      const existing = await read(root, path);
      if (existing !== null && existing !== body) throw Error('Baseline file corrupted; refusing overwrite');
      if (existing === null) await atomic(root, path, body);
      entry[`${field}Ref`] = ref;
      lazy(root, entry, field);
    } else if (!entry[`${field}Ref`]) throw Error(`Missing ${field} baseline`);
    else if (!descriptor) lazy(root, entry, field);
  }
  await atomic(root, '.edgeever/state.json', JSON.stringify(state, null, 2) + '\n');
}
export async function migrateStorage(root, state, dryRun = false) {
  if (state.version === 4) return { status:'current', version:4 };
  if (state.version !== 3) throw Error('Migrate document format first');
  if (dryRun) return { status:'would-migrate', version:4, notes:Object.keys(state.entries).length };
  const backup = `.edgeever/migrations/storage-${randomUUID()}/state.json`;
  await atomic(root, backup, await read(root, '.edgeever/state.json'));
  for (const entry of Object.values(state.entries)) entry.serverBase ??= entry.base;
  state.version = 4;
  await saveState(root, state); // Baselines durable before publishing the reference-only index.
  return { status:'migrated', version:4, backup };
}
