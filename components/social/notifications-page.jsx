'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSocial } from '@/components/providers/social-provider.jsx';
import { SocialGate } from '@/components/social/social-gate.jsx';
import { useSocialPoll } from '@/components/social/use-social-poll.js';
import { AppButton } from '@/components/ui/app-button.jsx';
import { EmptyState, Icon, PageHeader } from '@/components/ui/ui.jsx';

const labels = {
  friend_request: { icon: 'user', label: 'Заявка в друзья' },
  friend_accepted: { icon: 'check', label: 'Новый друг' },
  message: { icon: 'message', label: 'Новое сообщение' },
  like: { icon: 'heart', label: 'Ваш образ понравился' },
  comment: { icon: 'message', label: 'Новый комментарий' },
};

function notificationLink(notification) {
  if (notification.conversationId)
    return '/messages?' + new URLSearchParams({ conversation: notification.conversationId });
  if (notification.postId)
    return '/community?' + new URLSearchParams({ post: notification.postId });
  if (notification.type === 'friend_request' || notification.type === 'friend_accepted')
    return '/community?tab=friends';
  return notification.actor?.username
    ? '/people/' + encodeURIComponent(notification.actor.username)
    : '/community';
}

function notificationDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString('ru-RU', {
        day: 'numeric',
        month: 'long',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '';
}

function NotificationsContent() {
  const { request, refresh, counts } = useSocial();
  const requestRef = useRef(request);
  const refreshRef = useRef(refresh);
  requestRef.current = request;
  refreshRef.current = refresh;
  const [notifications, setNotifications] = useState([]);
  const [ready, setReady] = useState(false);
  const [cursor, setCursor] = useState(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [onlyUnread, setOnlyUnread] = useState(false);
  const firstPageFlight = useRef(null);
  const mutating = useRef(false);
  const hasOlderPages = useRef(false);
  const oldestCursor = useRef(null);
  const visible = onlyUnread
    ? notifications.filter((notification) => !notification.read)
    : notifications;

  const load = useCallback(async (signal, replace = false) => {
    if (firstPageFlight.current && !firstPageFlight.current.signal?.aborted) return;
    const flight = { signal };
    firstPageFlight.current = flight;
    try {
      const result = await requestRef.current('notifications.list', {}, { signal });
      if (signal?.aborted) return;
      setNotifications((previous) => {
        if (replace || !hasOlderPages.current) return result.notifications;
        const entries = new Map(previous.map((entry) => [entry.id, entry]));
        result.notifications.forEach((entry) => entries.set(entry.id, entry));
        return [...entries.values()].sort(
          (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
        );
      });
      if (replace || !hasOlderPages.current) {
        oldestCursor.current = result.nextCursor || null;
        setCursor(result.nextCursor || null);
      }
      if (replace) hasOlderPages.current = false;
      setReady(true);
      setError('');
    } catch (cause) {
      if (cause.name !== 'AbortError' && !signal?.aborted) {
        setError(cause.message || 'Не удалось загрузить уведомления.');
        setReady(true);
      }
    } finally {
      if (firstPageFlight.current === flight) firstPageFlight.current = null;
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  useSocialPoll(async (signal) => {
    if (!mutating.current) await load(signal);
    await refreshRef.current({ signal, quiet: true });
  });

  async function loadMore() {
    if (!cursor || loadingMore) return;
    const requestedCursor = cursor;
    setLoadingMore(true);
    setError('');
    try {
      const result = await requestRef.current('notifications.list', { cursor: requestedCursor });
      if (oldestCursor.current !== requestedCursor) return;
      hasOlderPages.current = true;
      setNotifications((previous) => {
        const entries = new Map(previous.map((entry) => [entry.id, entry]));
        result.notifications.forEach((entry) => entries.set(entry.id, entry));
        return [...entries.values()].sort(
          (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
        );
      });
      oldestCursor.current = result.nextCursor || null;
      setCursor(result.nextCursor || null);
    } catch (cause) {
      if (cause.name !== 'AbortError')
        setError(cause.message || 'Не удалось загрузить ранние уведомления.');
    } finally {
      setLoadingMore(false);
    }
  }

  async function markRead(ids) {
    if (mutating.current) return;
    mutating.current = true;
    setBusy(ids?.[0] || 'all');
    setError('');
    setNotice('');
    try {
      await requestRef.current('notifications.read', ids ? { ids } : {});
      setNotifications((previous) =>
        previous.map((notification) =>
          !ids || ids.includes(notification.id) ? { ...notification, read: true } : notification,
        ),
      );
      setNotice(ids ? 'Отмечено прочитанным.' : 'Уведомления отмечены прочитанными.');
      await refreshRef.current({ quiet: true });
    } catch (cause) {
      if (cause.name !== 'AbortError')
        setError(cause.message || 'Не удалось обновить уведомления.');
    } finally {
      mutating.current = false;
      setBusy('');
    }
  }

  return (
    <>
      <div className="social-notifications-toolbar">
        <div className="social-notification-filters" aria-label="Фильтр уведомлений">
          <AppButton
            className={`btn ${!onlyUnread ? 'btn-primary' : 'btn-secondary'}`}
            aria-pressed={!onlyUnread}
            onClick={() => setOnlyUnread(false)}
          >
            Все
          </AppButton>
          <AppButton
            className={`btn ${onlyUnread ? 'btn-primary' : 'btn-secondary'}`}
            aria-pressed={onlyUnread}
            onClick={() => setOnlyUnread(true)}
          >
            Непрочитанные{counts.notifications > 0 ? ` · ${counts.notifications}` : ''}
          </AppButton>
        </div>
        <div className="social-notification-actions">
          <AppButton
            className="btn btn-ghost"
            disabled={!!busy || loadingMore}
            onClick={() => load(undefined, true)}
          >
            <Icon name="refresh" />
            Обновить
          </AppButton>
          <AppButton
            className="btn btn-secondary"
            disabled={!!busy || !ready}
            onClick={() => markRead()}
          >
            <Icon name="check" />
            {busy === 'all' ? 'Отмечаем…' : 'Прочитать все'}
          </AppButton>
        </div>
      </div>
      <p className="social-notifications-preferences">
        <Link href="/community?tab=profile">Настроить уведомления в профиле</Link>
      </p>
      {error && (
        <div className="notice notice-error social-messaging-notice" role="alert">
          <span>{error}</span>
          <AppButton className="btn btn-ghost" onClick={() => load()}>
            Повторить
          </AppButton>
        </div>
      )}
      <p className="sr-only" role="status">
        {notice}
      </p>
      {!ready && (
        <p className="social-messaging-status" role="status">
          Загружаем уведомления…
        </p>
      )}
      {ready && !visible.length && !error && (
        <EmptyState
          icon="bell"
          title={
            onlyUnread
              ? cursor
                ? 'В этой части списка всё прочитано'
                : 'Всё прочитано'
              : 'Здесь будут ваши новости'
          }
          description={
            onlyUnread
              ? cursor
                ? 'Загрузите ранние уведомления, чтобы проверить остальное.'
                : 'Новых уведомлений пока нет.'
              : 'Когда вам напишут, отправят заявку или отреагируют на образ, здесь появится уведомление.'
          }
        />
      )}
      <ul className="social-notification-list" aria-label="Уведомления">
        {visible.map((notification) => {
          const kind = labels[notification.type] || { icon: 'bell', label: 'Уведомление' };
          return (
            <li
              key={notification.id}
              className={`social-notification${notification.read ? '' : ' is-unread'}`}
            >
              <span
                className={`social-notification-icon type-${notification.type}`}
                aria-hidden="true"
              >
                <Icon name={kind.icon} size={23} />
              </span>
              <div className="social-notification-copy">
                <div className="social-notification-title">
                  <strong>{kind.label}</strong>
                  {!notification.read && (
                    <span className="social-notification-unread-label">Новое</span>
                  )}
                </div>
                <p>
                  {notification.actor?.username ? (
                    <Link href={'/people/' + encodeURIComponent(notification.actor.username)}>
                      {notification.actor.name || notification.actor.username}
                    </Link>
                  ) : (
                    'Пользователь'
                  )}
                  {notification.text ? <> · {notification.text}</> : ''}
                </p>
                <time dateTime={notification.createdAt}>
                  {notificationDate(notification.createdAt)}
                </time>
                <div className="social-notification-item-actions">
                  <Link
                    className="social-notification-open"
                    href={notificationLink(notification)}
                    onClick={() => {
                      if (!notification.read) void markRead([notification.id]);
                    }}
                  >
                    Открыть <Icon name="arrow-right" size={16} />
                  </Link>
                  {!notification.read && (
                    <AppButton
                      className="btn btn-ghost"
                      disabled={!!busy}
                      onClick={() => markRead([notification.id])}
                    >
                      {busy === notification.id ? 'Отмечаем…' : 'Отметить прочитанным'}
                    </AppButton>
                  )}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      {cursor && (
        <div className="social-notifications-more">
          <AppButton
            className="btn btn-secondary"
            disabled={loadingMore || !!busy}
            onClick={loadMore}
          >
            {loadingMore ? 'Загружаем…' : 'Показать ещё'}
          </AppButton>
        </div>
      )}
    </>
  );
}

export default function NotificationsPage() {
  const { user } = useSocial();
  return (
    <>
      <PageHeader
        eyebrow="ВАШЕ СООБЩЕСТВО"
        title="Уведомления"
        description="Заявки, разговоры и маленькие знаки внимания к вашим образам."
      />
      <SocialGate>
        <NotificationsContent key={user?.id || 'guest'} />
      </SocialGate>
    </>
  );
}
