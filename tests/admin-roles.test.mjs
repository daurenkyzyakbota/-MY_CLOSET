import test from 'node:test';
import assert from 'node:assert/strict';
import { createSocialService } from '../lib/social/service.js';

const admin = { id: 'a1111111-1111-4111-8111-111111111111', name: 'Админ' };
const member = { id: 'b2222222-2222-4222-8222-222222222222', name: 'Участник' };
const other = { id: 'c3333333-3333-4333-8333-333333333333', name: 'Другой' };

const profile = (user, extra = {}) => ({
  user_id: user.id,
  username: user === admin ? 'boss' : user === member ? 'bota' : 'other',
  name: user.name,
  bio: '',
  city: '',
  styles: '',
  private: false,
  allow_messages: 'friends',
  notifications: { likes: true, comments: true, friends: true, messages: true },
  created_at: new Date('2026-11-01T00:00:00Z'),
  has_avatar: false,
  friend_count: '0',
  post_count: '0',
  is_friend: false,
  blocked_me: false,
  blocked_other: false,
  requester_id: null,
  role: 'user',
  banned_at: null,
  ...extra,
});

// A tiny fake database: `roles` holds each account's role and block state.
function fakeDatabase(roles, extra = () => null) {
  const calls = [];
  const query = async (sql, values = []) => {
    calls.push({ sql, values });
    const custom = extra(sql, values);
    if (custom) return custom;
    if (sql.includes('AS requests')) return { rows: [{ messages: 0, notifications: 0, requests: 0 }] };
    if (sql.startsWith('SELECT role,banned_at FROM public.mycloset_profiles WHERE user_id=$1')) {
      const row = roles[values[0]];
      return { rows: row ? [row] : [] };
    }
    if (sql.startsWith('SELECT user_id,role,banned_at FROM public.mycloset_profiles')) {
      const row = roles[values[0]];
      return { rows: row ? [{ user_id: values[0], ...row }] : [] };
    }
    if (sql.includes('FROM public.mycloset_profiles p WHERE p.user_id=$2')) {
      const row = roles[values[1]];
      const user = [admin, member, other].find((entry) => entry.id === values[1]);
      return { rows: row && user ? [profile(user, row)] : [] };
    }
    return { rows: [] };
  };
  return {
    calls,
    writes: () => calls.filter(({ sql }) => /^(UPDATE|DELETE|INSERT)/.test(sql)),
    pool: { query, connect: async () => ({ query, release() {} }) },
  };
}

const roles = () => ({
  [admin.id]: { role: 'admin', banned_at: null },
  [member.id]: { role: 'user', banned_at: null },
  [other.id]: { role: 'admin', banned_at: null },
});

test('ordinary users, missing profiles and anonymous visitors cannot use admin actions', async () => {
  const db = fakeDatabase(roles());
  const service = createSocialService({ pool: db.pool });
  for (const [action, input] of [
    ['admin.overview', {}],
    ['admin.users.list', {}],
    ['admin.users.setRole', { userId: member.id, role: 'admin' }],
    ['admin.users.ban', { userId: other.id, banned: true }],
    ['admin.reports.resolve', { reportId: 'r1', decision: 'remove' }],
  ])
    await assert.rejects(service.execute(action, input, member), (error) => error.code === 'ADMIN_REQUIRED');
  await assert.rejects(
    service.execute('admin.overview', {}, { id: 'd4444444-4444-4444-8444-444444444444' }),
    (error) => error.status === 403,
  );
  await assert.rejects(service.execute('admin.overview', {}), (error) => error.status === 401);
  assert.equal(db.writes().length, 0);
});

test('a blocked administrator loses admin access', async () => {
  const db = fakeDatabase({ ...roles(), [admin.id]: { role: 'admin', banned_at: new Date() } });
  await assert.rejects(
    createSocialService({ pool: db.pool }).execute('admin.overview', {}, admin),
    (error) => error.code === 'ADMIN_REQUIRED',
  );
});

test('admins can assign the two roles but never change their own', async () => {
  const db = fakeDatabase(roles());
  const service = createSocialService({ pool: db.pool });
  assert.deepEqual(
    await service.execute('admin.users.setRole', { userId: member.id, role: 'admin' }, admin),
    { ok: true, role: 'admin' },
  );
  const update = db.writes().at(-1);
  assert.match(update.sql, /UPDATE public.mycloset_profiles SET role=\$2 WHERE user_id=\$1/);
  assert.deepEqual(update.values, [member.id, 'admin']);
  await assert.rejects(
    service.execute('admin.users.setRole', { userId: member.id, role: 'moderator' }, admin),
    (error) => error.status === 400,
  );
  await assert.rejects(
    service.execute('admin.users.setRole', { userId: admin.id, role: 'user' }, admin),
    (error) => error.code === 'SELF_ACTION',
  );
  assert.equal(db.writes().length, 1);
});

test('admins cannot block other admins or themselves, and can block and unblock users', async () => {
  const db = fakeDatabase(roles());
  const service = createSocialService({ pool: db.pool });
  await assert.rejects(
    service.execute('admin.users.ban', { userId: other.id, banned: true }, admin),
    (error) => error.code === 'TARGET_IS_ADMIN',
  );
  await assert.rejects(
    service.execute('admin.users.ban', { userId: admin.id, banned: true }, admin),
    (error) => error.code === 'SELF_ACTION',
  );
  assert.equal(db.writes().length, 0);
  await service.execute('admin.users.ban', { userId: member.id, banned: true }, admin);
  assert.match(db.writes().at(-1).sql, /SET banned_at=COALESCE\(banned_at,now\(\)\)/);
  await service.execute('admin.users.ban', { userId: member.id, banned: false }, admin);
  assert.match(db.writes().at(-1).sql, /SET banned_at=NULL/);
});

test('removing a reported post deletes it and closes every open report about it in one transaction', async () => {
  const db = fakeDatabase(roles(), (sql) => {
    if (sql.startsWith('SELECT id,target_type,target_id,status FROM public.mycloset_reports'))
      return { rows: [{ id: 'r1', target_type: 'post', target_id: 'post1', status: 'open' }] };
    if (sql.startsWith('UPDATE public.mycloset_reports')) return { rows: [{ id: 'r1' }, { id: 'r2' }] };
    return null;
  });
  const result = await createSocialService({ pool: db.pool }).execute(
    'admin.reports.resolve',
    { reportId: 'r1', decision: 'remove' },
    admin,
  );
  assert.deepEqual(result, { ok: true, resolved: 2 });
  const sqls = db.calls.map(({ sql }) => sql);
  assert.ok(sqls.includes('DELETE FROM public.mycloset_posts WHERE id=$1'));
  const close = db.calls.find(({ sql }) => sql.startsWith('UPDATE public.mycloset_reports'));
  assert.deepEqual(close.values, ['post', 'post1', 'remove', admin.id]);
  assert.equal(sqls.at(-1), 'COMMIT');
});

test('an already reviewed report is not decided twice', async () => {
  const db = fakeDatabase(roles(), (sql) =>
    sql.startsWith('SELECT id,target_type,target_id,status FROM public.mycloset_reports')
      ? { rows: [{ id: 'r1', target_type: 'post', target_id: 'post1', status: 'reviewed' }] }
      : null,
  );
  await assert.rejects(
    createSocialService({ pool: db.pool }).execute(
      'admin.reports.resolve',
      { reportId: 'r1', decision: 'dismiss' },
      admin,
    ),
    (error) => error.code === 'ALREADY_REVIEWED',
  );
  assert.equal(db.writes().length, 0);
  assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
});

test('user search escapes LIKE wildcards', async () => {
  const db = fakeDatabase(roles());
  await createSocialService({ pool: db.pool }).execute(
    'admin.users.list',
    { query: '50%_off', filter: 'banned' },
    admin,
  );
  const search = db.calls.find(({ sql }) => sql.includes('FROM public.mycloset_profiles p\n    WHERE'));
  assert.deepEqual(search.values, ['50%_off', '%50\\%\\_off%']);
  assert.match(search.sql, /p\.banned_at IS NOT NULL/);
});

test('a blocked account cannot publish or write, but can still read and tidy up', async () => {
  const db = fakeDatabase({ ...roles(), [member.id]: { role: 'user', banned_at: new Date() } });
  const service = createSocialService({ pool: db.pool });
  for (const [action, input] of [
    ['posts.save', { title: 'x' }],
    ['comments.save', { postId: 'p1', text: 'x' }],
    ['messages.send', { userId: other.id, text: 'x' }],
    ['profile.save', { name: 'x' }],
  ])
    await assert.rejects(service.execute(action, input, member), (error) => error.code === 'ACCOUNT_BANNED');
  assert.equal(db.writes().length, 0);
  await service.execute('notifications.read', {}, member);
  assert.equal(db.writes().length, 1);
});

test('role and block state are visible only on the own profile, and blocked authors leave the feed', async () => {
  const db = fakeDatabase(roles());
  const service = createSocialService({ pool: db.pool });
  const own = await service.execute('bootstrap', {}, admin);
  assert.equal(own.profile.isAdmin, true);
  assert.equal(own.profile.banned, false);
  const db2 = fakeDatabase(roles());
  const result = await createSocialService({ pool: db2.pool }).execute('bootstrap', {}, member);
  assert.equal(result.profile.isAdmin, false);
  await service.execute('posts.list', {}, admin);
  const feed = db.calls.find(({ sql }) => sql.includes('FROM public.mycloset_posts s JOIN public.mycloset_profiles p'));
  assert.match(feed.sql, /p\.banned_at IS NULL/);
});

test('the automatic roles migration matches db/007-roles.sql and runs only when columns are missing', async () => {
  const { readFile } = await import('node:fs/promises');
  const { ROLES_MIGRATION, ensureRolesSchema, rolesSchemaGuard } = await import('../lib/social/roles-schema.js');
  const file = await readFile(new URL('../db/007-roles.sql', import.meta.url), 'utf8');
  assert.equal(file.replace('BEGIN;\n', '').replace(/COMMIT;\s*$/, '').trim(), ROLES_MIGRATION);

  const fake = (present) => {
    const calls = [];
    const query = async (sql) => {
      calls.push(sql);
      return { rows: sql.includes('information_schema') ? [{ present }] : [] };
    };
    return { calls, pool: { query, connect: async () => ({ query, release() {} }) } };
  };
  const ready = fake(2);
  assert.equal(await ensureRolesSchema(ready.pool), false);
  assert.equal(ready.calls.length, 1);
  const old = fake(0);
  assert.equal(await ensureRolesSchema(old.pool), true);
  assert.deepEqual(old.calls.slice(1, 3), ['BEGIN', "SELECT pg_advisory_xact_lock(hashtextextended('mycloset:migration:007',0))"]);
  assert.equal(old.calls[3], ROLES_MIGRATION);
  assert.equal(old.calls.at(-1), 'COMMIT');

  const once = fake(2);
  const guard = rolesSchemaGuard(() => once.pool);
  await Promise.all([guard(), guard(), guard()]);
  assert.equal(once.calls.length, 1);
});

const postRow = (author) => ({
  id: 'e5555555-5555-4555-8555-555555555555',
  user_id: author.id,
  title: 'Образ',
  description: '',
  tags: [],
  visibility: 'public',
  created_at: new Date('2026-11-20T00:00:00Z'),
  updated_at: new Date('2026-11-20T00:00:00Z'),
  cursor_at: '2026-11-20T00:00:00.000000Z',
  snapshot: { items: [] },
  likes_count: '0',
  comments_count: '0',
  liked: false,
  saved: false,
});
const withPost = (author) => (sql) =>
  sql.includes('JOIN public.mycloset_profiles p ON p.user_id=s.user_id WHERE s.id=$2')
    ? { rows: [postRow(author)] }
    : null;

test('admins can remove any visible post from the feed and its open reports are closed', async () => {
  const db = fakeDatabase(roles(), withPost(member));
  const service = createSocialService({ pool: db.pool });
  const { post } = await service.execute('posts.get', { postId: postRow(member).id }, admin);
  assert.equal(post.owned, false);
  assert.equal(post.canModerate, true);
  assert.deepEqual(await service.execute('posts.delete', { postId: post.id }, admin), { ok: true });
  const remove = db.calls.find(({ sql }) => sql.startsWith('DELETE FROM public.mycloset_posts'));
  assert.deepEqual(remove.values, [post.id, member.id]);
  const close = db.calls.find(({ sql }) => sql.startsWith('UPDATE public.mycloset_reports'));
  assert.deepEqual(close.values, [post.id, admin.id]);
  assert.match(close.sql, /decision='remove'/);
});

test('ordinary users can neither moderate nor delete somebody else\'s post', async () => {
  const db = fakeDatabase(roles(), withPost(admin));
  const service = createSocialService({ pool: db.pool });
  const { post } = await service.execute('posts.get', { postId: postRow(admin).id }, member);
  assert.equal(post.canModerate, false);
  await assert.rejects(
    service.execute('posts.delete', { postId: post.id }, member),
    (error) => error.status === 403,
  );
  assert.equal(db.writes().length, 0);
});

test('an author deleting their own post does not touch reports', async () => {
  const db = fakeDatabase(roles(), withPost(member));
  await createSocialService({ pool: db.pool }).execute(
    'posts.delete',
    { postId: postRow(member).id },
    member,
  );
  assert.equal(db.writes().filter(({ sql }) => sql.startsWith('DELETE FROM public.mycloset_posts')).length, 1);
  assert.equal(db.writes().filter(({ sql }) => sql.startsWith('UPDATE public.mycloset_reports')).length, 0);
});
