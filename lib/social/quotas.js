import { SocialError } from './validation.js';

export const WRITE_QUOTAS = Object.freeze({
  messages: Object.freeze({ limit: 60, seconds: 60, label: 'сообщений' }),
  comments: Object.freeze({ limit: 30, seconds: 60, label: 'комментариев' }),
  friend_requests: Object.freeze({ limit: 20, seconds: 3600, label: 'заявок в друзья' }),
  posts: Object.freeze({ limit: 20, seconds: 3600, label: 'публикаций' }),
  reports: Object.freeze({ limit: 10, seconds: 3600, label: 'жалоб' }),
});

// Called inside the same transaction as the actual successful write. Rollback
// restores both the business data and its allowance; retries never pay twice.
export async function consumeWriteQuota(db, userId, category) {
  const policy = Object.hasOwn(WRITE_QUOTAS, category) ? WRITE_QUOTAS[category] : null;
  if (!policy) throw new Error('Unsupported write allowance.');
  const { rows } = await db.query(
    `
    WITH moment AS (SELECT statement_timestamp() AS at),
    quota_window AS (
      SELECT at,to_timestamp(floor(extract(epoch FROM at)/$3::integer)*$3::integer) AS starts
      FROM moment
    ), changed AS (
      INSERT INTO public.mycloset_write_quotas AS quota(user_id,category,bucket_start,used,expires_at)
      SELECT $1,$2,starts,1,starts+make_interval(secs=>$3::integer) FROM quota_window
      ON CONFLICT(user_id,category,bucket_start) DO UPDATE SET used=quota.used+1
      WHERE quota.used<$4::integer RETURNING used
    )
    SELECT EXISTS(SELECT 1 FROM changed) AS allowed,
      GREATEST(1,CEIL(EXTRACT(EPOCH FROM(starts+make_interval(secs=>$3::integer)-at)))::integer) AS retry_after
    FROM quota_window`,
    [userId, category, policy.seconds, policy.limit],
  );
  if (!rows[0]) throw new Error('Write allowance is unavailable.');
  if (!rows[0].allowed) {
    const retryAfter = Math.max(
      1,
      Math.min(policy.seconds, Number(rows[0].retry_after) || policy.seconds),
    );
    const error = new SocialError(
      `Слишком много ${policy.label}. Повторите попытку через ${retryAfter} с.`,
      429,
      'RATE_LIMITED',
    );
    error.retryAfter = retryAfter;
    throw error;
  }
  // The expiration index and fixed batch bound keep cleanup independent of the
  // total table size. Locked rows are left for a later successful write.
  await db.query(`
    WITH expired AS (
      SELECT ctid FROM public.mycloset_write_quotas WHERE expires_at<=statement_timestamp()
      ORDER BY expires_at LIMIT 32 FOR UPDATE SKIP LOCKED
    ) DELETE FROM public.mycloset_write_quotas quota USING expired WHERE quota.ctid=expired.ctid`);
}
