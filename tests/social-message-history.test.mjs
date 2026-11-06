import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocialService } from '../lib/social/service.js';
import { loadMessageBatch, mergeMessages, selectMessageRefresh } from '../lib/social/message-history.js';
import { decodeCursor, encodeCursor } from '../lib/social/validation.js';

const user = { id: 'viewer' };
const conversationId = 'conversation';
const profile = {
  user_id: user.id,
  username: 'viewer',
  name: 'Бота',
  created_at: new Date('2026-11-06T00:00:00Z'),
};
const message = (index) => ({
  id: `message-${String(999 - index).padStart(3, '0')}`,
  conversation_id: conversationId,
  sender_id: 'peer',
  text: `Сообщение ${index}`,
  created_at: new Date('2026-11-06T00:00:00.000Z'),
  cursor_at: `2026-11-06T00:00:00.${String(index).padStart(6, '0')}Z`,
});

function fixture(initial = []) {
  let records = initial;
  const calls = [];
  const service = createSocialService({
    pool: {
      async query(sql, values) {
        calls.push({ sql, values });
        if (sql.includes('FROM public.mycloset_profiles p WHERE')) return { rows: [profile] };
        if (sql.includes('SELECT c.* FROM public.mycloset_conversations'))
          return { rows: [{ id: conversationId, user_a: user.id, user_b: 'peer' }] };
        if (sql.includes('FROM public.mycloset_messages m JOIN')) {
          assert.match(sql, /mycloset_blocks/);
          if (sql.includes('m.id=ANY')) return { rows: records.filter((row) => values[1].includes(row.id)) };
          const after = values[3];
          const before = values[1];
          assert.equal(values[5], user.id);
          assert.match(sql, /\(m.created_at,m.id\)>\(\$4,\$5\)/);
          assert.match(sql, after ? /ORDER BY m.created_at ASC,m.id ASC/ : /ORDER BY m.created_at DESC,m.id DESC/);
          const filtered = records.filter((row) =>
            (!after || row.cursor_at > after || (row.cursor_at === after && row.id > values[4])) &&
            (!before || row.cursor_at < before || (row.cursor_at === before && row.id < values[2])));
          const sorted = [...filtered].sort((a, b) =>
            a.cursor_at.localeCompare(b.cursor_at) || a.id.localeCompare(b.id));
          return { rows: (after ? sorted : sorted.reverse()).slice(0, 31) };
        }
        throw new Error('Unexpected query');
      },
    },
  });
  return {
    calls,
    setRecords(value) { records = value; },
    request: (action, input) => service.execute(action, input, user),
  };
}

test('catch-up loads every message after a long absence, preserving microseconds and avoiding duplicates', async () => {
  const db = fixture([message(1)]);
  const initial = await loadMessageBatch(db.request, conversationId);
  const all = Array.from({ length: 75 }, (_, index) => message(index + 1));
  db.setRecords(all);
  const updates = await loadMessageBatch(db.request, conversationId, { after: initial.latestCursor });
  const merged = mergeMessages(initial.messages, updates.messages);
  assert.equal(updates.messages.length, 74);
  assert.equal(updates.hasMore, false);
  assert.deepEqual(merged.map((entry) => entry.text), all.map((entry) => entry.text));
  assert.equal(merged[0].createdAt, all[0].cursor_at);
  assert.equal(merged.at(-1).createdAt, all.at(-1).cursor_at);
  assert.equal(decodeCursor(updates.latestCursor, `messages:${conversationId}`).at, all.at(-1).cursor_at);
  const repeated = await loadMessageBatch(db.request, conversationId, { after: updates.latestCursor });
  assert.equal(repeated.messages.length, 0);
  assert.equal(repeated.latestCursor, updates.latestCursor);
  assert.equal(mergeMessages(merged, updates.messages).length, 75);
  assert.ok(!db.calls.some((call) => call.sql.includes('mycloset_write_quotas')));
});

test('an initially empty conversation has a catch-up boundary and does not skip its first burst', async () => {
  const db = fixture();
  const initial = await loadMessageBatch(db.request, conversationId);
  assert.equal(initial.messages.length, 0);
  assert.ok(initial.latestCursor);
  db.setRecords(Array.from({ length: 45 }, (_, index) => message(index + 1)));
  const updates = await loadMessageBatch(db.request, conversationId, { after: initial.latestCursor });
  assert.equal(updates.messages.length, 45);
  assert.equal(updates.messages[0].text, 'Сообщение 1');
  assert.equal(updates.messages.at(-1).text, 'Сообщение 45');
});

test('old history still pages backwards and cannot combine two directions or use another conversation cursor', async () => {
  const db = fixture(Array.from({ length: 75 }, (_, index) => message(index + 1)));
  const initial = await loadMessageBatch(db.request, conversationId);
  assert.equal(initial.messages.length, 30);
  assert.equal(initial.messages[0].text, 'Сообщение 46');
  assert.ok(initial.nextCursor);
  const older = await db.request('messages.list', { conversationId, before: initial.nextCursor });
  assert.equal(older.messages[0].text, 'Сообщение 16');
  assert.equal(older.messages.at(-1).text, 'Сообщение 45');
  await assert.rejects(db.request('messages.list', {
    conversationId, before: initial.nextCursor, after: initial.latestCursor,
  }), (error) => error.status === 400);
  await assert.rejects(db.request('messages.list', {
    conversationId,
    after: encodeCursor('messages:someone-else', { at: '2026-11-06T00:00:00Z', id: 'secret' }),
  }), (error) => error.status === 400);
});

test('incremental reads reject a missing or blocked conversation before loading message text', async () => {
  const calls = [];
  const service = createSocialService({ pool: { query: async (sql) => {
    calls.push(sql);
    return { rows: sql.includes('FROM public.mycloset_profiles p WHERE') ? [profile] : [] };
  } } });
  await assert.rejects(service.execute('messages.list', {
    conversationId,
    after: encodeCursor(`messages:${conversationId}`, { at: '2026-11-06T00:00:00Z', id: 'message' }),
  }, user), (error) => error.status === 404);
  assert.ok(calls.some((sql) => sql.includes('mycloset_blocks')));
  assert.ok(!calls.some((sql) => sql.includes('FROM public.mycloset_messages')));
});

test('catch-up stops on abort and limits each poll while leaving a resumable cursor', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(loadMessageBatch(async () => {
    calls++;
    controller.abort();
    return { messages: [], latestCursor: 'next', hasMore: true };
  }, conversationId, { after: 'start', signal: controller.signal }), (error) => error.name === 'AbortError');
  assert.equal(calls, 1);
  const result = await loadMessageBatch(async () => ({
    messages: [{ id: String(++calls), createdAt: '2026-11-06T00:00:00.000000Z' }],
    latestCursor: `cursor-${calls}`, hasMore: true,
  }), conversationId, { after: 'start' });
  assert.equal(result.messages.length, 10);
  assert.equal(result.hasMore, true);
  assert.equal(result.latestCursor, 'cursor-11');
});

test('attachment refresh replaces a now-private link without advancing read-through or losing the catch-up boundary', async () => {
  const previous = {
    id: 'old', createdAt: '2026-11-06T00:00:00.000001Z',
    post: { id: 'post', title: 'Previously visible' },
  };
  const calls = [];
  const result = await loadMessageBatch(async (action, input) => {
    calls.push(input);
    return {
      messages: [], latestCursor: 'unchanged', hasMore: false,
      refreshedMessages: [{ ...previous, post: { id: 'post', unavailable: true } }],
    };
  }, conversationId, { after: 'unchanged', refreshIds: [previous.id] });
  assert.deepEqual(calls[0].refreshIds, ['old']);
  const merged = mergeMessages([previous], result.messages);
  assert.equal(merged.length, 1);
  assert.deepEqual(merged[0].post, { id: 'post', unavailable: true });
  assert.equal(result.latestCursor, 'unchanged');
  assert.equal(result.readThroughId, '');
});

test('refresh of a newer outgoing attachment never marks incoming messages in an unfinished gap as read', async () => {
  const result = await loadMessageBatch(async () => ({
    messages: [{ id: 'incoming-read', createdAt: '2026-11-06T00:00:00.000001Z' }],
    refreshedMessages: [{ id: 'own-newer', createdAt: '2026-11-06T00:00:01.000001Z', post: { unavailable: true } }],
    latestCursor: 'after-confirmed-page', hasMore: false,
  }), conversationId, { after: 'initial', refreshIds: ['own-newer'] });
  assert.equal(result.messages.at(-1).id, 'own-newer');
  assert.equal(result.readThroughId, 'incoming-read');
});

test('bounded attachment refresh rotates over the entire loaded history and excludes plain text', () => {
  const messages = Array.from({ length: 65 }, (_, index) => ({ id: String(index), post: { id: 'post' } }));
  messages.push({ id: 'plain', post: null });
  const checked = new Set();
  let offset = 0;
  for (let poll = 0; poll < 3; poll++) {
    const selection = selectMessageRefresh(messages, offset);
    assert.equal(selection.ids.length, 30);
    assert.equal(selection.ids.includes('plain'), false);
    selection.ids.forEach((id) => checked.add(id));
    offset = selection.nextOffset;
  }
  assert.equal(checked.size, 65);
  assert.deepEqual(selectMessageRefresh([]), { ids: [], nextOffset: 0 });
});

test('history and attachment refresh retain membership and block checks in the query that reads the text', async () => {
  const db = fixture([message(1)]);
  await db.request('messages.list', { conversationId, refreshIds: [message(1).id, 'not-in-this-conversation'] });
  const reads = db.calls.filter(({ sql }) => sql.includes('FROM public.mycloset_messages m JOIN'));
  assert.equal(reads.length, 2);
  for (const { sql } of reads) {
    assert.match(sql, /m.conversation_id=\$1/);
    assert.match(sql, /c.user_a=\$\d OR c.user_b=\$\d/);
    assert.match(sql, /mycloset_blocks/);
  }
  await assert.rejects(db.request('messages.list', { conversationId, refreshIds: Array(31).fill('id') }), (error) => error.status === 400);
  await assert.rejects(db.request('messages.list', { conversationId, refreshIds: ['../invalid'] }), (error) => error.status === 400);
});
