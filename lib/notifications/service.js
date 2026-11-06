import { randomUUID } from 'node:crypto';
import { NotificationError, genericPush, notificationPreferences, pushSubscription, pushEndpoint } from './validation.js';
import { pushConfiguration, sendWebPush } from './web-push.js';

const unblocked = (a, b) => `NOT EXISTS(SELECT 1 FROM public.mycloset_blocks b
  WHERE (b.blocker_id=${a} AND b.target_id=${b}) OR (b.blocker_id=${b} AND b.target_id=${a}))`;
const peer = "CASE WHEN c.user_a=m.sender_id THEN c.user_b ELSE c.user_a END";
const readableMessage = `p.messages AND m.created_at>=p.messages_enabled_at
  AND COALESCE((profile.notifications->>'messages')::boolean,true)
  AND m.created_at>CASE WHEN c.user_a=${peer} THEN c.read_a_at ELSE c.read_b_at END
  AND ${unblocked('m.sender_id', peer)}`;
const dueDate = "(($1::timestamptz AT TIME ZONE p.time_zone)::date+1)::text";
const liveSession = (subscription = 's') => `EXISTS(SELECT 1 FROM neon_auth.session managed
  WHERE managed.id=${subscription}.session_id AND managed."userId"=${subscription}.user_id AND managed."expiresAt">now())`;
const plannedTomorrow = `EXISTS(SELECT 1 FROM json_array_elements(w.snapshot::json->'plans') plan
  WHERE plan->>'date'=${dueDate} AND EXISTS(SELECT 1 FROM json_array_elements(w.snapshot::json->'outfits') outfit
    WHERE outfit->>'id'=plan->>'outfitId'))`;
const dto = (row) => ({
  messages: row?.messages || false,
  outfits: row?.outfits || false,
  timeZone: row?.time_zone || 'UTC',
  reminderHour: row?.reminder_hour ?? 20,
});

export function createNotificationService({ pool, send = sendWebPush, configuration = pushConfiguration, now = () => new Date() }) {
  const rows = async (sql, values = []) => (await pool.query(sql, values)).rows;
  async function preferences(userId) {
    const [row] = await rows('SELECT * FROM public.mycloset_notification_preferences WHERE user_id=$1::uuid', [userId]);
    const [count] = await rows(`SELECT count(*) AS total FROM public.mycloset_push_subscriptions s
      WHERE user_id=$1::uuid AND (expires_at IS NULL OR expires_at>now()) AND ${liveSession()}`, [userId]);
    const config = configuration();
    return { preferences: dto(row), preferencesConfigured: !!row, subscriptionCount: Number(count.total), available: config.available, publicKey: config.publicKey };
  }
  async function savePreferences(userId, input) {
    const value = notificationPreferences(input);
    const [zone] = await rows('SELECT name FROM pg_timezone_names WHERE name=$1', [value.timeZone]);
    if (!zone) throw new NotificationError('Этот часовой пояс пока не поддерживается.');
    await pool.query(`INSERT INTO public.mycloset_notification_preferences AS p(user_id,messages,outfits,time_zone,reminder_hour)
      VALUES($1::uuid,$2,$3,$4,$5) ON CONFLICT(user_id) DO UPDATE SET
      messages=EXCLUDED.messages,outfits=EXCLUDED.outfits,time_zone=EXCLUDED.time_zone,reminder_hour=EXCLUDED.reminder_hour,
      messages_enabled_at=CASE WHEN EXCLUDED.messages AND NOT p.messages THEN now() ELSE p.messages_enabled_at END,
      updated_at=now()`, [userId, value.messages, value.outfits, value.timeZone, value.reminderHour]);
    return preferences(userId);
  }
  async function subscribe(userId, input, sessionId) {
    if (!configuration().available) throw new NotificationError('Уведомления ещё подключаются. Попробуйте позже.', 503, 'NOT_CONFIGURED');
    if (typeof sessionId !== 'string' || !/^[0-9a-f-]{36}$/i.test(sessionId))
      throw new NotificationError('Войдите в аккаунт заново.', 401, 'UNAUTHORIZED');
    const value = await pushSubscription(input, now().getTime());
    const connection = await pool.connect();
    try {
      await connection.query('BEGIN');
      const { rows: sessions } = await connection.query(`SELECT id FROM neon_auth.session
        WHERE id=$1::uuid AND "userId"=$2::uuid AND "expiresAt">now()`, [sessionId, userId]);
      if (!sessions.length) throw new NotificationError('Войдите в аккаунт заново.', 401, 'UNAUTHORIZED');
      await connection.query("SELECT pg_advisory_xact_lock(hashtextextended('mycloset:push-user:'||$1,0))", [userId]);
      await connection.query("SELECT pg_advisory_xact_lock(hashtextextended('mycloset:push:'||$1,0))", [value.endpoint]);
      const { rows: owners } = await connection.query('SELECT user_id FROM public.mycloset_push_subscriptions WHERE endpoint=$1', [value.endpoint]);
      if (owners[0] && owners[0].user_id !== userId)
        throw new NotificationError('Подписка принадлежит другому входу. Нажмите разрешение ещё раз, чтобы обновить подписку этого браузера.', 409, 'SUBSCRIPTION_ACCOUNT_CHANGED');
      await connection.query(`INSERT INTO public.mycloset_push_subscriptions(id,user_id,endpoint,p256dh,auth,expires_at,session_id)
        VALUES($1,$2::uuid,$3,$4,$5,$6,$7::uuid) ON CONFLICT(endpoint) DO UPDATE SET
        user_id=EXCLUDED.user_id,p256dh=EXCLUDED.p256dh,auth=EXCLUDED.auth,expires_at=EXCLUDED.expires_at,
        created_at=CASE WHEN mycloset_push_subscriptions.session_id IS DISTINCT FROM EXCLUDED.session_id THEN now() ELSE mycloset_push_subscriptions.created_at END,
        session_id=EXCLUDED.session_id,updated_at=now()`, [randomUUID(), userId, value.endpoint, value.keys.p256dh, value.keys.auth,
        value.expirationTime === null ? null : new Date(value.expirationTime).toISOString(), sessionId]);
      // One explicit subscription represents one browser. Bound fan-out per account.
      await connection.query(`DELETE FROM public.mycloset_push_subscriptions WHERE id IN
        (SELECT id FROM public.mycloset_push_subscriptions WHERE user_id=$1::uuid ORDER BY updated_at DESC,id LIMIT 100 OFFSET 5)`, [userId]);
      await connection.query('COMMIT');
    } catch (error) {
      await connection.query('ROLLBACK');
      throw error;
    } finally { connection.release(); }
    return preferences(userId);
  }
  async function unsubscribe(userId, input) {
    const endpoint = pushEndpoint(input.endpoint);
    await pool.query('DELETE FROM public.mycloset_push_subscriptions WHERE user_id=$1::uuid AND endpoint=$2', [userId, endpoint]);
    return { ok: true };
  }

  async function deliver(userId, eventKey, kind, payload, createdAt, budget) {
    if (!configuration().available || budget.remaining <= 0) return { sent: 0, failed: 0, expired: 0 };
    const subscriptions = await rows(`SELECT * FROM public.mycloset_push_subscriptions s
      WHERE user_id=$1::uuid AND (expires_at IS NULL OR expires_at>now()) AND created_at<=$2::timestamptz AND ${liveSession()}
      ORDER BY created_at LIMIT 5`, [userId, createdAt]);
    const totals = { sent: 0, failed: 0, expired: 0 };
    for (const subscription of subscriptions) {
      if (budget.remaining <= 0) break;
      const [claim] = await rows(`INSERT INTO public.mycloset_push_deliveries AS d(subscription_id,event_key,kind,status,lease_until)
        VALUES($1,$2,$3,'sending',now()+interval '2 minutes') ON CONFLICT(subscription_id,event_key)
        DO UPDATE SET status='sending',attempts=d.attempts+1,lease_until=now()+interval '2 minutes',updated_at=now()
        WHERE d.status IN ('failed','sending') AND d.lease_until<=now() AND d.attempts<3 RETURNING subscription_id`,
      [subscription.id, eventKey, kind]);
      if (!claim) continue;
      const [authorized] = await rows(`SELECT EXISTS(SELECT 1 FROM public.mycloset_push_subscriptions s
        WHERE s.id=$1 AND ${liveSession()}) AS valid`, [subscription.id]);
      if (!authorized.valid) continue;
      budget.remaining--;
      let outcome;
      try {
        outcome = await send({ endpoint: subscription.endpoint, expirationTime: null,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth } }, payload);
      } catch { outcome = { status: 'failed' }; }
      if (outcome.status === 'expired') {
        await pool.query('DELETE FROM public.mycloset_push_subscriptions WHERE id=$1 AND user_id=$2::uuid', [subscription.id, userId]);
        totals.expired++;
      } else {
        const status = outcome.status === 'sent' ? 'sent' : 'failed';
        await pool.query(`UPDATE public.mycloset_push_deliveries SET status=$3,updated_at=now()
          WHERE subscription_id=$1 AND event_key=$2`, [subscription.id, eventKey, status]);
        totals[status]++;
      }
    }
    return totals;
  }
  async function message(messageId, budget = { remaining: 5 }) {
    if (!configuration().available) return { sent: 0, failed: 0, expired: 0 };
    const [row] = await rows(`SELECT m.id,m.conversation_id,m.created_at,${peer} AS recipient_id
      FROM public.mycloset_messages m JOIN public.mycloset_conversations c ON c.id=m.conversation_id
      JOIN public.mycloset_notification_preferences p ON p.user_id::text=${peer}
      JOIN public.mycloset_profiles profile ON profile.user_id=${peer}
      WHERE m.id=$1 AND ${readableMessage}`, [messageId]);
    if (!row) return { sent: 0, failed: 0, expired: 0 };
    return deliver(row.recipient_id, 'message:' + row.id, 'message', genericPush('message', {
      messageId: row.id, conversationId: row.conversation_id,
    }), row.created_at, budget);
  }
  async function dispatch() {
    const instant = now().toISOString();
    const budget = { remaining: 20 };
    const totals = { sent: 0, failed: 0, expired: 0 };
    const add = (result) => Object.keys(totals).forEach((key) => { totals[key] += result[key] || 0; });
    await pool.query(`DELETE FROM public.mycloset_push_subscriptions WHERE id IN
      (SELECT id FROM public.mycloset_push_subscriptions WHERE expires_at<=now() LIMIT 100)`);
    const messages = await rows(`SELECT m.id FROM public.mycloset_messages m
      JOIN public.mycloset_conversations c ON c.id=m.conversation_id
      JOIN public.mycloset_notification_preferences p ON p.user_id::text=${peer}
      JOIN public.mycloset_profiles profile ON profile.user_id=${peer}
      WHERE m.created_at>now()-interval '1 day' AND ${readableMessage}
      AND EXISTS(SELECT 1 FROM public.mycloset_push_subscriptions s WHERE s.user_id=p.user_id AND s.created_at<=m.created_at
        AND (s.expires_at IS NULL OR s.expires_at>now())
        AND ${liveSession()}
        AND NOT EXISTS(SELECT 1 FROM public.mycloset_push_deliveries d WHERE d.subscription_id=s.id
          AND d.event_key='message:'||m.id AND (d.status='sent' OR d.attempts>=3)))
      ORDER BY m.created_at,m.id LIMIT 10`);
    for (const entry of messages) {
      if (budget.remaining <= 0) break;
      add(await message(entry.id, budget));
    }
    const reminders = await rows(`SELECT p.user_id,${dueDate} AS date
      FROM public.mycloset_notification_preferences p JOIN public.mycloset_wardrobes w ON w.user_id=p.user_id::text
      WHERE p.outfits AND EXTRACT(HOUR FROM ($1::timestamptz AT TIME ZONE p.time_zone))=p.reminder_hour
      AND ${plannedTomorrow}
      AND EXISTS(SELECT 1 FROM public.mycloset_push_subscriptions s WHERE s.user_id=p.user_id
        AND (s.expires_at IS NULL OR s.expires_at>now())
        AND ${liveSession()}
        AND NOT EXISTS(SELECT 1 FROM public.mycloset_push_deliveries d WHERE d.subscription_id=s.id
          AND d.event_key='outfit:'||${dueDate} AND (d.status='sent' OR d.attempts>=3)))
      ORDER BY p.user_id LIMIT 20`, [instant]);
    for (const reminder of reminders) {
      if (budget.remaining <= 0) break;
      add(await deliver(reminder.user_id, 'outfit:' + reminder.date, 'outfit',
        genericPush('outfit', { date: reminder.date }), instant, budget));
    }
    await pool.query(`DELETE FROM public.mycloset_push_deliveries WHERE (subscription_id,event_key) IN
      (SELECT subscription_id,event_key FROM public.mycloset_push_deliveries WHERE created_at<now()-interval '30 days' LIMIT 100)`);
    return { ok: true, ...totals };
  }
  return { preferences, savePreferences, subscribe, unsubscribe, message, dispatch };
}
