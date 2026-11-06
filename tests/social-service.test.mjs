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
  assert.equal(new URL(result.profile.avatar, 'http://localhost').searchParams.get('id'), user.id);
  assert.equal(new URL(result.profile.avatar, 'http://localhost').searchParams.get('v'), profileRow.created_at.toISOString());
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

test('a comment hidden by a concurrent block is omitted rather than becoming a null list item', async () => {
  const db = recorder((sql, values) => {
    if (sql.includes('FROM public.mycloset_posts s JOIN'))
      return { rows: [{
        id: 'post', user_id: user.id, title: 'Образ', snapshot: { items: [] },
        created_at: new Date('2026-11-06T00:00:00Z'),
        updated_at: new Date('2026-11-06T00:00:00Z'),
      }] };
    if (sql.includes('FROM public.mycloset_profiles p WHERE'))
      return { rows: [{ ...profileRow, user_id: values[1], blocked_other: values[1] === 'blocked-peer' }] };
    if (sql.includes('FROM public.mycloset_comments c WHERE'))
      return { rows: [{
        id: 'comment', user_id: 'blocked-peer', text: 'Private after block',
        created_at: new Date('2026-11-06T00:00:00Z'),
        updated_at: new Date('2026-11-06T00:00:00Z'),
      }] };
    return { rows: [] };
  });
  const result = await createSocialService({ pool: db.pool }).execute('comments.list', { postId: 'post' }, user);
  assert.deepEqual(result.comments, []);
  assert.equal(JSON.stringify(result).includes('Private after block'), false);
});

test('a committed message retry survives a later friends-only policy and does not insert, notify or consume quota again', async () => {
  const clientId = '531fa670-e5a7-4abb-8564-caf60141d6fb';
  const existing = {
    id: 'sent', conversation_id: 'conversation', sender_id: user.id,
    text: 'Уже доставлено', post_id: null, had_post: false,
    created_at: new Date('2026-11-06T00:00:00Z'),
  };
  const db = recorder((sql, values) => {
    if (sql.includes('FROM public.mycloset_profiles p WHERE'))
      return { rows: [{ ...profileRow, user_id: values[1], allow_messages: 'friends', is_friend: false }] };
    if (sql.includes('SELECT c.* FROM public.mycloset_conversations'))
      return { rows: [{ id: 'conversation', user_a: user.id, user_b: 'peer' }] };
    if (sql.includes('WHERE sender_id=$1 AND client_id=$2')) return { rows: [existing] };
    return { rows: [] };
  });
  const service = createSocialService({ pool: db.pool });
  const result = await service.execute('messages.send', { conversationId: 'conversation', text: existing.text, clientId }, user);
  assert.equal(result.message.id, existing.id);
  assert.equal(db.calls.some(({ sql }) => /INSERT INTO public.mycloset_(messages|notifications|write_quotas)/.test(sql)), false);
  await assert.rejects(service.execute('messages.send', {
    conversationId: 'conversation', text: 'Изменённый текст', clientId,
  }, user), (error) => error.code === 'MESSAGE_CHANGED');
});

test('a committed shared-post retry returns an unavailable attachment after its visibility changes', async () => {
  const db = recorder((sql) => {
    if (sql.includes('FROM public.mycloset_profiles p WHERE')) return { rows: [profileRow] };
    if (sql.includes('SELECT c.* FROM public.mycloset_conversations'))
      return { rows: [{ id: 'conversation', user_a: user.id, user_b: 'peer' }] };
    if (sql.includes('WHERE sender_id=$1 AND client_id=$2')) return { rows: [{
      id: 'sent', conversation_id: 'conversation', sender_id: user.id, text: 'Образ',
      post_id: 'private-post', had_post: true, created_at: new Date('2026-11-06T00:00:00Z'),
    }] };
    return { rows: [] };
  });
  const result = await createSocialService({ pool: db.pool }).execute('messages.send', {
    conversationId: 'conversation', text: 'Образ', postId: 'private-post',
    clientId: '531fa670-e5a7-4abb-8564-caf60141d6fb',
  }, user);
  assert.deepEqual(result.message.post, { id: 'private-post', unavailable: true });
  assert.equal(db.calls.some(({ sql }) => sql.includes('mycloset_write_quotas')), false);
});

test('a committed retry cannot bypass a later block or participant revocation', async () => {
  const db = recorder((sql) => ({ rows: sql.includes('FROM public.mycloset_profiles p WHERE') ? [profileRow] : [] }));
  await assert.rejects(createSocialService({ pool: db.pool }).execute('messages.send', {
    conversationId: 'conversation', text: 'Уже доставлено',
    clientId: '531fa670-e5a7-4abb-8564-caf60141d6fb',
  }, user), (error) => error.status === 404);
  assert.equal(db.calls.some(({ sql }) => sql.includes('WHERE sender_id=$1 AND client_id=$2')), false);
});

test('changing an avatar updates its image URL while keeping raw photos and private identity out of the profile', async () => {
  let changedAt = new Date('2026-11-06T00:00:00Z');
  const db = recorder(() => ({ rows: [{ ...profileRow, updated_at: changedAt }] }));
  const service = createSocialService({ pool: db.pool });
  const first = await service.execute('profile.get', { username: profileRow.username });
  changedAt = new Date('2026-11-06T00:00:01Z');
  const second = await service.execute('profile.get', { username: profileRow.username });
  assert.notEqual(first.profile.avatar, second.profile.avatar);
  assert.equal(new URL(first.profile.avatar, 'http://localhost').searchParams.get('id'), user.id);
  assert.equal(new URL(second.profile.avatar, 'http://localhost').searchParams.get('id'), user.id);
  assert.equal(JSON.stringify(second).includes('base64'), false);
});

test('a retry after physical attachment deletion stays a safe conflict instead of accepting an unprovable changed request', async () => {
  const db = recorder((sql) => {
    if (sql.includes('FROM public.mycloset_profiles p WHERE')) return { rows: [profileRow] };
    if (sql.includes('SELECT c.* FROM public.mycloset_conversations'))
      return { rows: [{ id: 'conversation', user_a: user.id, user_b: 'peer' }] };
    if (sql.includes('WHERE sender_id=$1 AND client_id=$2')) return { rows: [{
      id: 'sent', conversation_id: 'conversation', sender_id: user.id, text: 'Образ',
      post_id: null, had_post: true, created_at: new Date('2026-11-06T00:00:00Z'),
    }] };
    return { rows: [] };
  });
  await assert.rejects(createSocialService({ pool: db.pool }).execute('messages.send', {
    conversationId: 'conversation', text: 'Образ', postId: 'deleted-post',
    clientId: '531fa670-e5a7-4abb-8564-caf60141d6fb',
  }, user), (error) => error.status === 409 && error.code === 'MESSAGE_CHANGED');
  assert.equal(db.calls.some(({ sql }) => /INSERT INTO public.mycloset_(messages|write_quotas)/.test(sql)), false);
});
