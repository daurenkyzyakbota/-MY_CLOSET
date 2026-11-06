import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocialService } from '../lib/social/service.js';
import {
  SocialError,
  profilePatch,
  postInput,
  snapshot,
  photo,
  username,
  text,
  encodeCursor,
  decodeCursor,
} from '../lib/social/validation.js';

const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a5e0AAAAASUVORK5CYII=';
const user = {
  id: 'f9391930-aeed-43c9-bc52-c12792d9253a',
  name: 'Бота',
  email: 'not-public@example.invalid',
};
const profileRow = {
  user_id: user.id,
  username: 'bota',
  name: 'Бота',
  bio: '',
  city: '',
  styles: '',
  private: false,
  allow_messages: 'friends',
  notifications: { likes: true, comments: true, friends: true, messages: true },
  created_at: new Date('2026-10-31T01:02:03Z'),
  has_avatar: true,
  friend_count: '0',
  post_count: '0',
  is_friend: false,
  blocked_me: false,
  blocked_other: false,
  requester_id: null,
};
function recorder(handler = () => ({ rows: [] })) {
  const calls = [];
  let released = false;
  const query = async (sql, values = []) => {
    calls.push({ sql, values });
    return handler(sql, values);
  };
  return {
    calls,
    pool: {
      query,
      connect: async () => ({
        query,
        release() {
          released = true;
        },
      }),
    },
    released: () => released,
  };
}

test('profile patch allows only bounded public fields and normalizes unique usernames', () => {
  assert.equal(username(' BOTA_01 '), 'bota_01');
  const patch = profilePatch({
    username: 'bota',
    name: ' Бота ',
    private: true,
    notifications: { messages: false },
  });
  assert.equal(patch.name, 'Бота');
  assert.deepEqual(patch.notifications, { messages: false });
  for (const value of ['ab', 'русский', 'a/b', 'x'.repeat(31), '__proto__!'])
    assert.throws(() => username(value), SocialError);
  assert.throws(() => profilePatch({ name: 'Бота', userId: 'someone-else' }), SocialError);
  assert.throws(() => profilePatch({ email: 'exposed@example.invalid' }), SocialError);
  assert.throws(() => profilePatch({ private: 'true' }), SocialError);
  assert.throws(() => profilePatch({ notifications: { admin: true } }), SocialError);
});

test('profile text rejects NUL, nonstrings and unbounded content before PostgreSQL', () => {
  assert.throws(() => text('hello\u0000world', 'О себе', 500), SocialError);
  assert.throws(() => text('hello\ud800world', 'О себе', 500), SocialError);
  assert.throws(() => profilePatch({ bio: 'a'.repeat(501) }), SocialError);
  assert.throws(() => profilePatch({ name: '' }), SocialError);
  assert.throws(() => profilePatch({ city: ['Алматы'] }), SocialError);
  assert.equal(text('первая\nвторая', 'Комментарий', 100), 'первая\nвторая');
});

test('only bounded static raster images are accepted for public media', () => {
  assert.equal(photo(png), png);
  for (const value of [
    'https://example.invalid/user.jpg',
    'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,SGVsbG8=',
    'data:text/html;base64,PHNjcmlwdD4=',
  ])
    assert.throws(() => photo(value), SocialError);
  assert.throws(() => photo(png, 30), SocialError);
  const giant = Buffer.from(png.split(',')[1], 'base64');
  giant.writeUInt32BE(100000, 16);
  assert.throws(() => photo('data:image/png;base64,' + giant.toString('base64')), SocialError);
});

test('publication snapshots include only intentionally selected garment details', () => {
  const value = {
    name: 'Прогулка',
    items: [{ id: 'shirt', name: 'Рубашка', category: 'top', colors: ['white'], photo: png }],
  };
  assert.equal(snapshot(value).items[0].photo, png);
  assert.throws(() => snapshot({ ...value, privateWardrobe: {} }), SocialError);
  assert.throws(
    () => snapshot({ ...value, items: [{ ...value.items[0], notes: 'private' }] }),
    SocialError,
  );
  assert.throws(() => snapshot({ ...value, items: [...value.items, ...value.items] }), SocialError);
  assert.throws(
    () => snapshot({ ...value, items: [{ ...value.items[0], colors: ['invisible'] }] }),
    SocialError,
  );
  assert.throws(() => snapshot({ ...value, items: [] }), SocialError);
  assert.throws(
    () =>
      snapshot({
        ...value,
        items: Array.from({ length: 31 }, (_, index) => ({
          ...value.items[0],
          id: 'item-' + index,
        })),
      }),
    SocialError,
  );
});

test('post edits retain existing snapshots when no replacement is supplied', () => {
  const draft = postInput({
    postId: 'post-1',
    title: ' Новое название ',
    description: '',
    tags: ['#стиль', 'стиль'],
    visibility: 'friends',
  });
  assert.equal(draft.title, 'Новое название');
  assert.deepEqual(draft.tags, ['стиль']);
  assert.equal(Object.hasOwn(draft, 'snapshot'), false);
  assert.throws(() => postInput({ title: 'Образ', tags: [], visibility: 'everyone' }), SocialError);
  assert.throws(
    () => postInput({ title: 'Образ', tags: Array(11).fill('тег'), visibility: 'public' }),
    SocialError,
  );
});

test('pagination cursors preserve microseconds and cannot be reused for a different list', () => {
  const at = '2026-10-31T01:02:03.456789Z';
  const cursor = encodeCursor('posts:public:', { at, id: 'post-1' });
  assert.equal(decodeCursor(cursor, 'posts:public:').at, at);
  assert.throws(() => decodeCursor(cursor, 'posts:friends:'), SocialError);
  assert.throws(() => decodeCursor('!not-base64!', 'people'), SocialError);
  assert.throws(
    () => decodeCursor(encodeCursor('messages:x', { at: 'not-a-date', id: 'x' }), 'messages:x'),
    SocialError,
  );
});

test('anonymous mutations and unknown operations never acquire a database connection', async () => {
  const db = recorder();
  const service = createSocialService({ pool: db.pool });
  await assert.rejects(
    service.execute('profile.save', { username: 'x' }),
    (error) => error.status === 401,
  );
  await assert.rejects(service.execute('messages.send', {}), (error) => error.status === 401);
  await assert.rejects(
    service.execute('constructor', {}, user),
    (error) => error.code === 'UNKNOWN_ACTION',
  );
  assert.equal(db.calls.length, 0);
});

test('public profile responses never include email, auth state or raw photos', async () => {
  const db = recorder(() => ({
    rows: [{ ...profileRow, email: 'private@example.invalid', avatar: png, auth_user_id: user.id }],
  }));
  const result = await createSocialService({ pool: db.pool }).execute('profile.get', {
    username: 'bota',
  });
  assert.equal(result.profile.avatar, '/api/social/media?type=avatar&id=' + user.id);
  assert.equal(Object.hasOwn(result.profile, 'email'), false);
  assert.equal(Object.hasOwn(result.profile, 'auth_user_id'), false);
  assert.ok(!JSON.stringify(result).includes('base64'));
  assert.deepEqual(result.profile.notifications, {});
});

test('closed profiles expose their basic identity while hiding private details', async () => {
  const db = recorder(() => ({
    rows: [{ ...profileRow, private: true, bio: 'private biography', city: 'private city' }],
  }));
  const { profile } = await createSocialService({ pool: db.pool }).execute('profile.get', {
    username: 'bota',
  });
  assert.equal(profile.name, 'Бота');
  assert.equal(profile.canViewPosts, false);
  assert.equal(profile.bio, '');
  assert.equal(profile.city, '');
});

test('blocking in either direction suppresses a public profile lookup', async () => {
  for (const field of ['blocked_me', 'blocked_other']) {
    const db = recorder(() => ({ rows: [{ ...profileRow, [field]: true }] }));
    await assert.rejects(
      createSocialService({ pool: db.pool }).execute('profile.get', { username: 'bota' }, user),
      (error) => error.status === 404,
    );
  }
});

test('media reads include the ownership/visibility/block predicate in the image query itself', async () => {
  const db = recorder(() => ({ rows: [] }));
  await assert.rejects(
    createSocialService({ pool: db.pool }).execute(
      'media.get',
      { type: 'post', id: 'post-1', item: 'shirt' },
      user,
    ),
    (error) => error.status === 404,
  );
  assert.equal(db.calls.length, 1);
  assert.match(db.calls[0].sql, /mycloset_blocks/);
  assert.match(db.calls[0].sql, /visibility='public'/);
  assert.match(db.calls[0].sql, /mycloset_relationships/);
  assert.deepEqual(db.calls[0].values, [user.id, 'post-1', 'shirt']);
});

test('mutations commit only after complete success and always release the connection', async () => {
  const db = recorder();
  const result = await createSocialService({ pool: db.pool }).execute('account.delete', {}, user);
  assert.deepEqual(result, { ok: true });
  assert.equal(db.calls[0].sql, 'BEGIN');
  assert.ok(db.calls.some((call) => call.sql.includes('pg_advisory_xact_lock')));
  assert.equal(db.calls.at(-1).sql, 'COMMIT');
  const deletion = db.calls.filter((call) => call.sql.startsWith('DELETE'));
  assert.equal(deletion.length, 2);
  assert.ok(deletion.every((call) => call.values.length === 1 && call.values[0] === user.id));
  assert.ok(deletion.every((call) => !call.sql.includes('neon_auth')));
  assert.equal(db.released(), true);
});

test('a failed second write rolls the entire transaction back instead of partially deleting', async () => {
  const db = recorder((sql) => {
    if (sql.includes('DELETE FROM public.mycloset_wardrobes'))
      throw new Error('database unavailable');
    return { rows: [] };
  });
  await assert.rejects(
    createSocialService({ pool: db.pool }).execute('account.delete', {}, user),
    /database unavailable/,
  );
  assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(
    db.calls.some((call) => call.sql === 'COMMIT'),
    false,
  );
  assert.equal(db.released(), true);
});

test('SQL uniqueness failures become bounded user errors after rollback', async () => {
  const db = recorder((sql) => {
    if (sql.includes('INSERT INTO public.mycloset_profiles'))
      throw Object.assign(new Error('SQL internals must not leak'), { code: '23505' });
    return { rows: [] };
  });
  await assert.rejects(
    createSocialService({ pool: db.pool }).execute(
      'profile.save',
      { username: 'bota', name: 'Бота' },
      user,
    ),
    (error) =>
      error.status === 409 && error.code === 'ALREADY_EXISTS' && !error.message.includes('SQL'),
  );
  assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(db.released(), true);
});
