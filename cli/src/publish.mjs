import { validateRemoteBody } from './file-workspace/metadata.mjs';

// A direct update replaces the full supplied body. Guard races from the initial
// remote read onward; workspace sync is required for a stored editing baseline.
export async function updateMemo(client, id, payload) {
  if (payload.contentMarkdown === undefined) return client.request(`/api/v1/memos/${encodeURIComponent(id)}`, { method: 'PATCH', body: payload });
  validateRemoteBody(payload.contentMarkdown);
  const path = `/api/v1/memos/${encodeURIComponent(id)}`;
  const { memo } = await client.request(path);
  const { editSession } = await client.request(`${path}/edit-sessions`, { method: 'POST' });
  if (!Number.isInteger(memo?.revision) || typeof memo.contentHash !== 'string' || !editSession?.id || editSession.baseRevision !== memo.revision || editSession.baseContentHash !== memo.contentHash) throw Error('Remote changed before update, or edit-session response is invalid. Re-read and review the full body; use workspace sync for tracked files.');
  return client.request(path, { method: 'PATCH', body: { ...payload, expectedRevision: memo.revision, expectedContentHash: memo.contentHash, editSessionId: editSession.id } });
}
