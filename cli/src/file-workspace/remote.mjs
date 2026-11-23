export async function listActiveMemos(client, selectedNotebookIds) {
  const memos = [];
  let cursor;
  const seen = new Set();
  do {
    const params = new URLSearchParams({ limit: '100', includeTotal: '0' });
    if (cursor) params.set('cursor', cursor);
    const page = await client.request(`/api/v1/memos?${params}`);
    for (const memo of page.memos) {
      if (!selectedNotebookIds || selectedNotebookIds.has(memo.notebookId)) memos.push(memo);
    }
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw Error('Repeated pagination cursor');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return memos;
}
