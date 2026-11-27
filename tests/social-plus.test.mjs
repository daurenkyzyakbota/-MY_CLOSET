import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createSocialService } from '../lib/social/service.js';
import { SocialError, snapshot } from '../lib/social/validation.js';
import { SOCIAL_PLUS_MIGRATION, ensureSocialPlusSchema } from '../lib/social/social-plus-schema.js';

const viewer = { id: 'f9391930-aeed-43c9-bc52-c12792d9253a', name: 'Бота' };
const otherId = 'a1b2c3d4-0000-4000-8000-000000000001';
const profile = (userId, changes = {}) => ({
  user_id: userId,
  username: userId === viewer.id ? 'bota' : 'aru',
  name: 'Профиль',
  bio: '',
  city: '',
  styles: '',
  private: false,
  allow_messages: 'friends',
  notifications: {},
  created_at: new Date('2026-11-01T00:00:00Z'),
  has_avatar: false,
  friend_count: '0',
  post_count: '0',
  is_friend: false,
  blocked_me: false,
  blocked_other: false,
  requester_id: null,
  follower_count: '3',
  following_count: '1',
  follow_status: null,
  follows_me: false,
  ...changes,
});
const postRow = (changes = {}) => ({
  id: 'post',
  user_id: otherId,
  title: 'Что надеть?',
  description: '',
  tags: [],
  visibility: 'public',
  snapshot: {
    name: 'Опрос',
    items: [],
    poll: {
      options: [
        { label: 'А', itemIds: ['a'] },
        { label: 'Б', itemIds: ['b'] },
      ],
    },
  },
  likes_count: '0',
  comments_count: '0',
  poll_counts: [2, 1],
  poll_vote: null,
  created_at: new Date('2026-11-20T00:00:00Z'),
  updated_at: new Date('2026-11-20T00:00:00Z'),
  ...changes,
});

function database(handler) {
  const calls = [];
  const query = async (sql, values = []) => {
    calls.push({ sql, values });
    return handler(sql, values) || { rows: [] };
  };
  return { calls, pool: { query, connect: async () => ({ query, release() {} }) } };
}
const profiles =
  (overrides = {}) =>
  (sql, values) => {
    if (sql.includes('FROM public.mycloset_profiles p WHERE p.user_id=$2'))
      return { rows: [profile(values[1], overrides[values[1]])] };
    if (sql.includes('consume') || sql.includes('mycloset_write_quotas'))
      return { rows: [{ allowed: true, retry_after: 1 }] };
  };

test('migration 008 matches db/008-social-plus.sql and runs only when something is missing', async () => {
  const file = await readFile(new URL('../db/008-social-plus.sql', import.meta.url), 'utf8');
  assert.equal(
    file
      .replace('BEGIN;\n', '')
      .replace(/COMMIT;\s*$/, '')
      .trim(),
    SOCIAL_PLUS_MIGRATION,
  );
  const ready = database(() => ({ rows: [{ tables: 4, columns: 3 }] }));
  assert.equal(await ensureSocialPlusSchema(ready.pool), false);
  assert.equal(ready.calls.length, 1);
  const old = database((sql) =>
    sql.startsWith('SELECT\n') ? { rows: [{ tables: 0, columns: 0 }] } : null,
  );
  assert.equal(await ensureSocialPlusSchema(old.pool), true);
  assert.deepEqual(old.calls.map(({ sql }) => sql).slice(1, 3), [
    'BEGIN',
    "SELECT pg_advisory_xact_lock(hashtextextended('mycloset:migration:008',0))",
  ]);
  assert.equal(old.calls.at(-1).sql, 'COMMIT');
});

test('a poll needs exactly two variants built from the post items', () => {
  const items = ['a', 'b', 'shoe'].map((itemId) => ({
    id: itemId,
    name: itemId,
    category: 'top',
    colors: [],
  }));
  const good = snapshot({
    name: 'А или Б',
    items,
    poll: {
      options: [
        { label: 'Платье', itemIds: ['a', 'shoe'] },
        { label: '', itemIds: ['b', 'shoe'] },
      ],
    },
  });
  assert.deepEqual(
    good.poll.options.map((option) => option.label),
    ['Платье', 'Б'],
  );
  for (const options of [
    [{ itemIds: ['a', 'b', 'shoe'] }],
    [{ itemIds: ['a'] }, { itemIds: ['b'] }],
    [{ itemIds: ['a', 'shoe'] }, { itemIds: ['x', 'b'] }],
    [{ itemIds: ['a', 'shoe'] }, { itemIds: [] }],
  ])
    assert.throws(() => snapshot({ name: 'x', items, poll: { options } }), SocialError);
});

test('poll results stay hidden until you vote, and a vote can be changed', async () => {
  let voted = null;
  const db = database((sql, values) => {
    if (sql.includes('FROM public.mycloset_posts s JOIN'))
      return { rows: [postRow({ poll_vote: voted })] };
    if (sql.startsWith('INSERT INTO public.mycloset_poll_votes')) voted = values[2];
    return profiles()(sql, values);
  });
  const service = createSocialService({ pool: db.pool });
  const before = await service.execute('posts.get', { postId: 'post' }, viewer);
  assert.equal(before.post.poll.options[0].votes, null);
  assert.equal(before.post.poll.total, null);
  const after = await service.execute('posts.vote', { postId: 'post', option: 1 }, viewer);
  assert.match(
    db.calls.find(({ sql }) => sql.startsWith('INSERT INTO public.mycloset_poll_votes')).sql,
    /ON CONFLICT\(post_id,user_id\) DO UPDATE/,
  );
  assert.equal(after.post.poll.myVote, 1);
  assert.deepEqual(
    after.post.poll.options.map((option) => option.votes),
    [2, 1],
  );
  await assert.rejects(
    service.execute('posts.vote', { postId: 'post', option: 2 }, viewer),
    SocialError,
  );
});

test('voting on a post without a poll is refused', async () => {
  const db = database((sql, values) => {
    if (sql.includes('FROM public.mycloset_posts s JOIN'))
      return { rows: [postRow({ snapshot: { name: 'x', items: [] } })] };
    return profiles()(sql, values);
  });
  await assert.rejects(
    createSocialService({ pool: db.pool }).execute(
      'posts.vote',
      { postId: 'post', option: 0 },
      viewer,
    ),
    (error) => error.code === 'NO_POLL',
  );
  assert.equal(
    db.calls.some(({ sql }) => sql.startsWith('INSERT INTO public.mycloset_poll_votes')),
    false,
  );
});

test('an open profile is followed at once, a private one gets a request', async () => {
  for (const [isPrivate, status, kind] of [
    [false, 'accepted', 'follow'],
    [true, 'pending', 'follow_request'],
  ]) {
    const db = database(profiles({ [otherId]: { private: isPrivate } }));
    await createSocialService({ pool: db.pool }).execute(
      'follows.set',
      { userId: otherId, following: true },
      viewer,
    );
    const insert = db.calls.find(({ sql }) =>
      sql.startsWith('INSERT INTO public.mycloset_follows'),
    );
    assert.deepEqual(insert.values, [viewer.id, otherId, status]);
    const notification = db.calls.find(({ sql }) =>
      sql.includes('INSERT INTO public.mycloset_notifications'),
    );
    assert.equal(notification.values[2], kind);
  }
  const self = database(profiles());
  await assert.rejects(
    createSocialService({ pool: self.pool }).execute(
      'follows.set',
      { userId: viewer.id, following: true },
      viewer,
    ),
    SocialError,
  );
});

test('following a private profile opens its posts; profiles report follower counts', async () => {
  const lookup = database((sql) =>
    sql.includes('WHERE p.username=$2')
      ? { rows: [profile(otherId, { private: true, follow_status: 'accepted' })] }
      : null,
  );
  const { profile: result } = await createSocialService({ pool: lookup.pool }).execute(
    'profile.get',
    { username: 'aru' },
    viewer,
  );
  assert.equal(result.canViewPosts, true);
  assert.equal(result.following, 'accepted');
  assert.equal(result.followerCount, 3);
  assert.equal(result.followingCount, 1);
});

test('blocking someone also removes follows in both directions', async () => {
  const db = database(profiles());
  await createSocialService({ pool: db.pool }).execute(
    'users.block',
    { userId: otherId, blocked: true },
    viewer,
  );
  assert.ok(
    db.calls.some(({ sql }) =>
      sql.startsWith(
        'DELETE FROM public.mycloset_follows WHERE (follower_id=$1 AND followee_id=$2) OR',
      ),
    ),
  );
});

test('a reply to a reply joins the top-level thread and notifies both people', async () => {
  const db = database((sql, values) => {
    if (sql.includes('FROM public.mycloset_posts s JOIN')) return { rows: [postRow()] };
    if (sql.startsWith('SELECT id,user_id,parent_id FROM public.mycloset_comments'))
      return {
        rows: [
          { id: 'reply-1', user_id: 'c0ffee00-0000-4000-8000-000000000002', parent_id: 'root' },
        ],
      };
    if (sql.startsWith('INSERT INTO public.mycloset_comments'))
      return {
        rows: [
          {
            id: values[0],
            post_id: 'post',
            user_id: viewer.id,
            text: values[3],
            parent_id: values[4],
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      };
    return profiles()(sql, values);
  });
  const { comment } = await createSocialService({ pool: db.pool }).execute(
    'comments.save',
    { postId: 'post', parentId: 'reply-1', text: 'Согласна!' },
    viewer,
  );
  assert.equal(comment.parentId, 'root');
  const kinds = db.calls
    .filter(({ sql }) => sql.includes('INSERT INTO public.mycloset_notifications'))
    .map(({ values }) => [values[5], values[2]]);
  assert.deepEqual(kinds, [
    ['c0ffee00-0000-4000-8000-000000000002', 'reply'],
    [otherId, 'reply'],
  ]);
});

test('comments come as top-level threads with their replies and like counts', async () => {
  const at = new Date('2026-11-20T00:00:00Z');
  const db = database((sql, values) => {
    if (sql.includes('FROM public.mycloset_posts s JOIN')) return { rows: [postRow()] };
    if (sql.includes('c.parent_id IS NULL'))
      return {
        rows: [
          {
            id: 'root',
            user_id: otherId,
            text: 'Платье!',
            parent_id: null,
            likes_count: '2',
            liked: true,
            created_at: at,
            updated_at: at,
          },
        ],
      };
    if (sql.includes('c.parent_id=ANY'))
      return {
        rows: [
          {
            id: 'r1',
            user_id: viewer.id,
            text: 'Да',
            parent_id: 'root',
            likes_count: '0',
            liked: false,
            created_at: at,
            updated_at: at,
          },
        ],
      };
    return profiles()(sql, values);
  });
  const { comments } = await createSocialService({ pool: db.pool }).execute(
    'comments.list',
    { postId: 'post' },
    viewer,
  );
  assert.equal(comments.length, 1);
  assert.equal(comments[0].likesCount, 2);
  assert.equal(comments[0].liked, true);
  assert.deepEqual(
    comments[0].replies.map((reply) => reply.id),
    ['r1'],
  );
});

test('the following feed combines own posts, follows and friends', async () => {
  const db = database(profiles());
  await createSocialService({ pool: db.pool }).execute(
    'posts.list',
    { scope: 'following' },
    viewer,
  );
  const feed = db.calls.find(({ sql }) => sql.includes('ORDER BY s.created_at DESC,s.id DESC'));
  assert.match(
    feed.sql,
    /s\.user_id=\$1 OR EXISTS \(SELECT 1 FROM public\.mycloset_follows f WHERE f\.follower_id=\$1/,
  );
  await assert.rejects(
    createSocialService({ pool: db.pool }).execute('posts.list', { scope: 'following' }, null),
  );
});
