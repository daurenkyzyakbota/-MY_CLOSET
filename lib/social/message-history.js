const preciseTime = (value) =>
  value.replace(/\.(\d{1,6})Z$/, (_, fraction) => `.${fraction.padEnd(6, '0')}Z`);

export function mergeMessages(previous, incoming) {
  const entries = new Map(previous.map((message) => [message.id, message]));
  incoming.forEach((message) => entries.set(message.id, message));
  return [...entries.values()].sort(
    (a, b) =>
      preciseTime(a.createdAt).localeCompare(preciseTime(b.createdAt)) ||
      a.id.localeCompare(b.id),
  );
}

/** Rotate through loaded attachments so older links also reflect privacy changes. */
export function selectMessageRefresh(messages, offset = 0) {
  const candidates = messages.filter((message) => message.post).map((message) => message.id);
  if (!candidates.length) return { ids: [], nextOffset: 0 };
  const start = offset % candidates.length;
  const count = Math.min(30, candidates.length);
  return {
    ids: Array.from({ length: count }, (_, index) => candidates[(start + index) % candidates.length]),
    nextOffset: (start + count) % candidates.length,
  };
}

/** Catch up from the last confirmed read, including gaps larger than one page. */
export async function loadMessageBatch(request, conversationId, { after, signal, refreshIds = [] } = {}) {
  let cursor = after;
  let result;
  let messages = [];
  let refreshed = [];
  let readThroughId = '';
  for (let page = 0; page < 10; page++) {
    signal?.throwIfAborted();
    result = await request(
      'messages.list',
      {
        conversationId,
        ...(cursor ? { after: cursor } : {}),
        ...(page === 0 && refreshIds.length ? { refreshIds } : {}),
      },
      { signal },
    );
    signal?.throwIfAborted();
    messages = mergeMessages(messages, result.messages);
    refreshed = mergeMessages(refreshed, result.refreshedMessages || []);
    if (result.messages.length) readThroughId = result.messages.at(-1).id;
    if (!cursor || !result.hasMore || result.latestCursor === cursor) break;
    cursor = result.latestCursor;
  }
  return { ...result, messages: mergeMessages(messages, refreshed), readThroughId };
}
