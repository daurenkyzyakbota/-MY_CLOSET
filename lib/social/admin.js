// Administration for MyCloset's community. There are exactly two roles:
// 'user' (everyone by default) and 'admin'. Every admin action re-reads the
// caller's role from the database, so hiding a button is never the only guard.
import { SocialError, object, text, id, boolean, choice } from './validation.js';

export const ROLES = ['user', 'admin'];
export const ADMIN_READ_ACTIONS = ['admin.overview', 'admin.reports.list', 'admin.users.list'];
export const ADMIN_WRITE_ACTIONS = [
  'admin.reports.resolve',
  'admin.users.setRole',
  'admin.users.ban',
];
// A blocked account keeps read access and may still tidy up its own data.
export const BANNED_ALLOWED_ACTIONS = new Set([
  'messages.read',
  'notifications.read',
  'notifications.preferences.save',
  'users.block',
  'account.delete',
]);

const PAGE = 100;
const iso = (value) => (value ? new Date(value).toISOString() : null);
const count = (value) => Number(value) || 0;
const forbidden = () =>
  new SocialError('Этот раздел доступен только администраторам.', 403, 'ADMIN_REQUIRED');
const missing = () => new SocialError('Запись не найдена или больше недоступна.', 404, 'NOT_FOUND');
const likePattern = (value) => `%${value.replace(/[\\%_]/g, '\\$&')}%`;

export const bannedError = () =>
  new SocialError(
    'Ваш аккаунт заблокирован администратором: публиковать и писать сообщения нельзя.',
    403,
    'ACCOUNT_BANNED',
  );

async function requireAdmin(session) {
  if (!session.viewer) throw new SocialError('Войдите в аккаунт.', 401, 'AUTH_REQUIRED');
  const [row] = await session.rows(
    'SELECT role,banned_at FROM public.mycloset_profiles WHERE user_id=$1',
    [session.viewer],
  );
  if (!row || row.role !== 'admin' || row.banned_at) throw forbidden();
}

async function overview(session, input) {
  object(input, []);
  const [row] = await session.rows(`SELECT
    (SELECT count(*) FROM public.mycloset_profiles) AS users,
    (SELECT count(*) FROM public.mycloset_profiles WHERE created_at>now()-interval '7 days') AS new_users,
    (SELECT count(*) FROM public.mycloset_profiles WHERE role='admin') AS admins,
    (SELECT count(*) FROM public.mycloset_profiles WHERE banned_at IS NOT NULL) AS banned,
    (SELECT count(*) FROM public.mycloset_posts) AS posts,
    (SELECT count(*) FROM public.mycloset_comments) AS comments,
    (SELECT count(*) FROM public.mycloset_reports WHERE status='open') AS open_reports`);
  return {
    stats: {
      users: count(row?.users),
      newUsers: count(row?.new_users),
      admins: count(row?.admins),
      banned: count(row?.banned),
      posts: count(row?.posts),
      comments: count(row?.comments),
      openReports: count(row?.open_reports),
    },
  };
}

function reportDto(row) {
  return {
    id: row.id,
    targetType: row.target_type,
    targetId: row.target_id,
    reason: row.reason,
    status: row.status,
    decision: row.decision || null,
    createdAt: iso(row.created_at),
    resolvedAt: iso(row.resolved_at),
    reporter: row.reporter_username
      ? { username: row.reporter_username, name: row.reporter_name }
      : null,
    target: {
      exists: !!row.target_user_id,
      userId: row.target_user_id || null,
      username: row.target_username || null,
      name: row.target_name || null,
      role: row.target_role || null,
      banned: !!row.target_banned_at,
      postTitle: row.post_title || null,
      postDescription: row.post_description || null,
    },
    sameTargetCount: count(row.same_target),
  };
}

async function listReports(session, input) {
  object(input, ['status']);
  const status = choice(input.status ?? 'open', ['open', 'reviewed'], 'Статус жалоб');
  const rows = await session.rows(
    `SELECT r.id,r.target_type,r.target_id,r.reason,r.status,r.decision,r.created_at,r.resolved_at,
      rp.username AS reporter_username,rp.name AS reporter_name,
      s.title AS post_title,left(s.description,300) AS post_description,
      t.user_id AS target_user_id,t.username AS target_username,t.name AS target_name,
      t.role AS target_role,t.banned_at AS target_banned_at,
      (SELECT count(*) FROM public.mycloset_reports r2
        WHERE r2.target_type=r.target_type AND r2.target_id=r.target_id AND r2.status=r.status) AS same_target
    FROM public.mycloset_reports r
    LEFT JOIN public.mycloset_profiles rp ON rp.user_id=r.reporter_id
    LEFT JOIN public.mycloset_posts s ON r.target_type='post' AND s.id=r.target_id
    LEFT JOIN public.mycloset_profiles t ON t.user_id=CASE WHEN r.target_type='post' THEN s.user_id ELSE r.target_id END
    WHERE r.status=$1
    ORDER BY ${status === 'open' ? 'r.created_at' : 'r.resolved_at'} DESC NULLS LAST,r.id DESC
    LIMIT ${PAGE}`,
    [status],
  );
  return { reports: rows.map(reportDto) };
}

async function resolveReport(session, input) {
  object(input, ['reportId', 'decision']);
  const reportId = id(input.reportId, 'номер жалобы');
  const decision = choice(input.decision, ['dismiss', 'remove'], 'Решение');
  const [report] = await session.rows(
    'SELECT id,target_type,target_id,status FROM public.mycloset_reports WHERE id=$1 FOR UPDATE',
    [reportId],
  );
  if (!report) throw missing();
  if (report.status !== 'open')
    throw new SocialError('Эту жалобу уже рассмотрели. Обновите список.', 409, 'ALREADY_REVIEWED');
  if (decision === 'remove') {
    if (report.target_type === 'post') {
      await session.db.query('DELETE FROM public.mycloset_posts WHERE id=$1', [report.target_id]);
    } else {
      if (report.target_id === session.viewer)
        throw new SocialError('Нельзя заблокировать собственный аккаунт.', 409, 'SELF_ACTION');
      const [target] = await session.rows(
        'SELECT role FROM public.mycloset_profiles WHERE user_id=$1 FOR UPDATE',
        [report.target_id],
      );
      if (target?.role === 'admin')
        throw new SocialError(
          'Это администратор. Сначала снимите с него роль администратора.',
          409,
          'TARGET_IS_ADMIN',
        );
      if (target)
        await session.db.query(
          'UPDATE public.mycloset_profiles SET banned_at=COALESCE(banned_at,now()) WHERE user_id=$1',
          [report.target_id],
        );
    }
  }
  // One decision closes every open report about the same post or profile.
  const { rows } = await session.db.query(
    `UPDATE public.mycloset_reports SET status='reviewed',decision=$3,resolved_by=$4,resolved_at=now()
    WHERE target_type=$1 AND target_id=$2 AND status='open' RETURNING id`,
    [report.target_type, report.target_id, decision, session.viewer],
  );
  return { ok: true, resolved: rows.length };
}

function userDto(row, viewer) {
  return {
    id: row.user_id,
    username: row.username,
    name: row.name,
    role: row.role,
    banned: !!row.banned_at,
    bannedAt: iso(row.banned_at),
    createdAt: iso(row.created_at),
    posts: count(row.posts),
    reports: count(row.reports),
    self: row.user_id === viewer,
  };
}

async function listUsers(session, input) {
  object(input, ['query', 'filter']);
  const query = text(input.query ?? '', 'Поиск', 80);
  const filter = choice(
    input.filter ?? 'all',
    ['all', 'admins', 'banned', 'reported', 'new'],
    'Фильтр',
  );
  const conditions = ["($1='' OR p.username ILIKE $2 OR p.name ILIKE $2)"];
  if (filter === 'admins') conditions.push("p.role='admin'");
  if (filter === 'banned') conditions.push('p.banned_at IS NOT NULL');
  if (filter === 'reported')
    conditions.push(`EXISTS (SELECT 1 FROM public.mycloset_reports r WHERE
        (r.target_type='profile' AND r.target_id=p.user_id) OR
        (r.target_type='post' AND r.target_id IN (SELECT s.id FROM public.mycloset_posts s WHERE s.user_id=p.user_id)))`);
  // «Новые» shows the latest sign-ups first; other lists keep administrators on top.
  const order =
    filter === 'new'
      ? 'p.created_at DESC,p.user_id'
      : "(p.role='admin') DESC,p.created_at DESC,p.user_id";
  const rows = await session.rows(
    `SELECT p.user_id,p.username,p.name,p.role,p.banned_at,p.created_at,
      (SELECT count(*) FROM public.mycloset_posts s WHERE s.user_id=p.user_id) AS posts,
      (SELECT count(*) FROM public.mycloset_reports r WHERE
        (r.target_type='profile' AND r.target_id=p.user_id) OR
        (r.target_type='post' AND r.target_id IN (SELECT s.id FROM public.mycloset_posts s WHERE s.user_id=p.user_id))) AS reports
    FROM public.mycloset_profiles p
    WHERE ${conditions.join(' AND ')}
    ORDER BY ${order}
    LIMIT ${PAGE}`,
    [query, likePattern(query)],
  );
  return { users: rows.map((row) => userDto(row, session.viewer)) };
}

async function lockTarget(session, userId) {
  if (userId === session.viewer)
    throw new SocialError(
      'Свою роль и блокировку менять нельзя, чтобы случайно не потерять доступ.',
      409,
      'SELF_ACTION',
    );
  const [row] = await session.rows(
    'SELECT user_id,role,banned_at FROM public.mycloset_profiles WHERE user_id=$1 FOR UPDATE',
    [userId],
  );
  if (!row) throw missing();
  return row;
}

async function setRole(session, input) {
  object(input, ['userId', 'role']);
  const userId = id(input.userId, 'идентификатор пользователя');
  const role = choice(input.role, ROLES, 'Роль');
  const target = await lockTarget(session, userId);
  if (role === 'admin' && target.banned_at)
    throw new SocialError(
      'Пользователь заблокирован. Сначала разблокируйте его.',
      409,
      'TARGET_BANNED',
    );
  await session.db.query('UPDATE public.mycloset_profiles SET role=$2 WHERE user_id=$1', [
    userId,
    role,
  ]);
  return { ok: true, role };
}

async function setBanned(session, input) {
  object(input, ['userId', 'banned']);
  const userId = id(input.userId, 'идентификатор пользователя');
  const banned = boolean(input.banned, 'Блокировка');
  const target = await lockTarget(session, userId);
  if (banned && target.role === 'admin')
    throw new SocialError(
      'Это администратор. Сначала снимите с него роль администратора.',
      409,
      'TARGET_IS_ADMIN',
    );
  await session.db.query(
    `UPDATE public.mycloset_profiles SET banned_at=${banned ? 'COALESCE(banned_at,now())' : 'NULL'} WHERE user_id=$1`,
    [userId],
  );
  return { ok: true, banned };
}

export async function adminDispatch(session, action, input) {
  await requireAdmin(session);
  switch (action) {
    case 'admin.overview':
      return overview(session, input);
    case 'admin.reports.list':
      return listReports(session, input);
    case 'admin.reports.resolve':
      return resolveReport(session, input);
    case 'admin.users.list':
      return listUsers(session, input);
    case 'admin.users.setRole':
      return setRole(session, input);
    case 'admin.users.ban':
      return setBanned(session, input);
    default:
      throw new SocialError('Неизвестное действие.', 400, 'UNKNOWN_ACTION');
  }
}
