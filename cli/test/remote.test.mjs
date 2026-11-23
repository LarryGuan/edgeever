import assert from 'node:assert/strict';
import test from 'node:test';
import { listActiveMemos } from '../src/file-workspace/remote.mjs';

test('lists the workspace once and filters selected notebooks locally', async () => {
  const requests = [];
  const pages = [
    { memos: [{ id: 'one', notebookId: 'nb_a' }, { id: 'two', notebookId: 'nb_b' }], nextCursor: 'page-2' },
    { memos: [{ id: 'three', notebookId: 'nb_a' }], nextCursor: null },
  ];
  const client = { request: async path => {
    requests.push(path);
    return pages[requests.length - 1];
  } };

  const memos = await listActiveMemos(client, new Set(['nb_a']));

  assert.deepEqual(memos.map(memo => memo.id), ['one', 'three']);
  assert.equal(requests.length, 2);
  assert.ok(requests.every(path => !path.includes('notebookId=')));
  assert.ok(requests.every(path => path.includes('includeTotal=0')));
  assert.ok(requests[1].includes('cursor=page-2'));
});

test('stops when the server repeats a pagination cursor', async () => {
  const client = { request: async () => ({ memos: [], nextCursor: 'same' }) };
  await assert.rejects(listActiveMemos(client), /Repeated pagination cursor/);
});
