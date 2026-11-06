import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createSocialService } from '../lib/social/service.js';
import { createSocialHandlers } from '../lib/social/handlers.js';
import { socialRequest } from '../lib/social/client.js';
import { consumeWriteQuota } from '../lib/social/quotas.js';
import {
  SocialError,
  feedFilters,
  messageSearch,
  idempotencyKey,
  postInput,
  encodeCursor,
} from '../lib/social/validation.js';

const user = { id: 'eca3aa47-e2be-4835-8901-7abc28c19ac3' };
const profile = {
  user_id: user.id,
  username: 'bota',
  name: 'Бота',
  bio: '',
  city: '',
  styles: '',
  private: false,
  allow_messages: 'everyone',
  notifications: {},
  created_at: new Date('2026-10-31T00:00:00Z'),
  has_avatar: false,
  friend_count: 0,
  post_count: 0,
  is_friend: false,
  blocked_me: false,
  blocked_other: false,
};
const request = (body) =>
  new Request('http://localhost:3007/api/social', {
    method: 'POST',
    headers: {
      Origin: 'http://localhost:3007',
      'Content-Type': 'application/json',
      'X-MyCloset-Account': user.id,
    },
    body: JSON.stringify(body),
  });

test('feed filters normalize case and hashtag without accepting unknown data types or excess lengths', () => {
  assert.deepEqual(
    feedFilters({ query: ' Белая рубашка ', tag: '#ЛЕТО', occasion: ' Casual ', style: 'MINIMAL' }),
    { query: 'белая рубашка', tag: 'лето', occasion: 'casual', style: 'minimal' },
  );
  assert.deepEqual(feedFilters({}), { query: '', tag: '', occasion: '', style: '' });
  for (const input of [
    { query: null },
    { query: 0 },
    { tag: [] },
    { style: false },
    { occasion: {} },
    { query: 'x'.repeat(101) },
    { tag: 'x'.repeat(41) },
    { style: 'x'.repeat(101) },
  ])
    assert.throws(() => feedFilters(input), SocialError);
});

test('message search is conversation-bound, literal and at least two characters', () => {
  assert.deepEqual(messageSearch({ conversationId: 'conversation', query: ' %_ ' }), {
    conversationId: 'conversation',
    query: '%_',
    cursor: undefined,
  });
  assert.throws(() => messageSearch({ conversationId: 'conversation', query: 'a' }), SocialError);
  assert.throws(
    () => messageSearch({ conversationId: 'conversation', query: 'x'.repeat(101) }),
    SocialError,
  );
  assert.throws(
    () => messageSearch({ conversationId: 'conversation', query: 'hi', userId: 'other' }),
    SocialError,
  );
  assert.throws(() => messageSearch({ conversationId: '../other', query: 'hi' }), SocialError);
});

test('publication retry keys are canonical UUIDs and malformed keys fail validation', () => {
  const clientId = randomUUID();
  assert.equal(idempotencyKey(clientId.toUpperCase()), clientId);
  assert.equal(
    postInput({ title: 'Образ', description: '', tags: [], visibility: 'private', clientId })
      .clientId,
    clientId,
  );
  for (const value of [null, 1, '', 'same-key', 'x'.repeat(36)])
    assert.throws(() => idempotencyKey(value), SocialError);
});

test('filtered feed binds every search value while retaining the central privacy predicate', async () => {
  let captured;
  const service = createSocialService({
    pool: {
      query: async (sql, values) => {
        captured = { sql, values };
        return { rows: [] };
      },
    },
  });
  const query = "' OR 1=1 --";
  const result = await service.execute('posts.list', {
    query,
    tag: '%_',
    style: 'casual',
    occasion: 'work',
  });
  assert.deepEqual(result, { posts: [], nextCursor: null });
  assert.equal(captured.sql.includes(query), false);
  assert.deepEqual(captured.values.slice(4), [null, query.toLowerCase(), '%_', 'work', 'casual']);
  assert.match(captured.sql, /mycloset_blocks/);
  assert.match(captured.sql, /NOT p\.private/);
  assert.match(captured.sql, /visibility='friends'/);
});

test('empty filters accept historical cursors, while an old unfiltered cursor cannot cross into a filtered feed', async () => {
  const cursor = encodeCursor('posts:public:', { at: '2026-10-31T00:00:00.123456Z', id: 'post' });
  let calls = 0;
  const service = createSocialService({
    pool: {
      query: async () => {
        calls++;
        return { rows: [] };
      },
    },
  });
  await service.execute('posts.list', { cursor, query: '', tag: '' });
  assert.equal(calls, 1);
  await assert.rejects(
    service.execute('posts.list', { cursor, query: 'рубашка' }),
    (error) => error.status === 400,
  );
  assert.equal(calls, 1);
});

test('message search rejects nonparticipants before searching any conversation text', async () => {
  const calls = [];
  let connections = 0;
  const pool = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: sql.includes('FROM public.mycloset_profiles p WHERE') ? [profile] : [] };
    },
    connect: async () => {
      connections++;
      throw new Error('Read search must not start a write transaction');
    },
  };
  await assert.rejects(
    createSocialService({ pool }).execute(
      'messages.search',
      { conversationId: 'other-conversation', query: 'secret' },
      user,
    ),
    (error) => error.status === 404,
  );
  assert.equal(connections, 0);
  assert.ok(!calls.some((call) => call.sql.includes('position($3')));
  assert.ok(!calls.some((call) => call.sql.includes('mycloset_write_quotas')));
});

test('message search exposes no shared post title after its permission is revoked', async () => {
  const calls = [];
  const pool = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      if (sql.includes('FROM public.mycloset_profiles p WHERE')) return { rows: [profile] };
      if (sql.includes('SELECT c.* FROM public.mycloset_conversations'))
        return { rows: [{ id: 'conversation', user_a: user.id, user_b: 'peer' }] };
      if (sql.includes('position($3'))
        return {
          rows: [
            {
              id: 'message',
              conversation_id: 'conversation',
              sender_id: 'peer',
              text: '100%_ exact',
              had_post: true,
              post_id: 'hidden-post',
              created_at: new Date('2026-10-31T00:00:00Z'),
            },
          ],
        };
      return { rows: [] };
    },
  };
  const result = await createSocialService({ pool }).execute(
    'messages.search',
    { conversationId: 'conversation', query: '%_' },
    user,
  );
  assert.equal(result.messages.length, 1);
  assert.deepEqual(result.messages[0].post, { id: 'hidden-post', unavailable: true });
  assert.equal(Object.hasOwn(result.messages[0].post, 'title'), false);
  const search = calls.find((call) => call.sql.includes('position($3'));
  assert.equal(search.values[2], '%_');
  assert.match(search.sql, /mycloset_blocks/);
  assert.match(search.sql, /c\.user_a=\$2 OR c\.user_b=\$2/);
});

test('exhausted durable allowance returns a bounded retry delay and performs no cleanup write', async () => {
  const calls = [];
  const db = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [{ allowed: false, retry_after: 17 }] };
    },
  };
  await assert.rejects(
    consumeWriteQuota(db, user.id, 'messages'),
    (error) => error.status === 429 && error.code === 'RATE_LIMITED' && error.retryAfter === 17,
  );
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].values, [user.id, 'messages', 60, 60]);
});

test('successful durable allowance runs bounded cleanup and cannot select an arbitrary quota policy', async () => {
  const calls = [];
  const db = {
    query: async (sql, values) => {
      calls.push({ sql, values });
      return { rows: [{ allowed: true, retry_after: 9 }] };
    },
  };
  await consumeWriteQuota(db, user.id, 'posts');
  assert.equal(calls.length, 2);
  assert.match(calls[1].sql, /LIMIT 32 FOR UPDATE SKIP LOCKED/);
  await assert.rejects(consumeWriteQuota(db, user.id, 'unlimited'), /Unsupported/);
  await assert.rejects(consumeWriteQuota(db, user.id, 'constructor'), /Unsupported/);
  assert.equal(calls.length, 2);
});

test('rate-limit responses preserve private headers and expose safe Retry-After metadata', async () => {
  const api = createSocialHandlers({
    configured: () => true,
    getUser: async () => user,
    service: {
      execute: async () => {
        throw Object.assign(new Error('Повторите позже.'), {
          status: 429,
          code: 'RATE_LIMITED',
          retryAfter: 25,
        });
      },
    },
  });
  const response = await api.POST(request({ action: 'messages.send', input: {} }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), '25');
  assert.match(response.headers.get('Cache-Control'), /private.*no-store/);
  assert.deepEqual(await response.json(), {
    error: 'Повторите позже.',
    code: 'RATE_LIMITED',
    retryAfter: 25,
  });
});

test('unsafe retry metadata is omitted rather than becoming a response header', async () => {
  const api = createSocialHandlers({
    configured: () => true,
    getUser: async () => user,
    service: {
      execute: async () => {
        throw Object.assign(new Error('Повторите позже.'), {
          status: 429,
          code: 'RATE_LIMITED',
          retryAfter: '25\r\nBad: value',
        });
      },
    },
  });
  const response = await api.POST(request({ action: 'messages.send', input: {} }));
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('Retry-After'), null);
  assert.equal(Object.hasOwn(await response.json(), 'retryAfter'), false);
});

test('social client preserves rate-limit retry metadata for the interface', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async () =>
    Response.json(
      { error: 'Повторите позже.', code: 'RATE_LIMITED', retryAfter: 15 },
      { status: 429, headers: { 'Retry-After': '15' } },
    );
  try {
    await assert.rejects(
      socialRequest('messages.send', {}, { userId: user.id }),
      (error) => error.status === 429 && error.code === 'RATE_LIMITED' && error.retryAfter === 15,
    );
  } finally {
    globalThis.fetch = original;
  }
});
