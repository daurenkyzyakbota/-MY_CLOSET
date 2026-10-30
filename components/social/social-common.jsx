'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSocial } from '@/components/providers/social-provider.jsx';
import { AppButton } from '@/components/ui/app-button.jsx';
import { ConfirmDialog, Field, Icon, Modal } from '@/components/ui/ui.jsx';

export function SocialNotice({ children, error = false, onRetry }) {
  if (!children) return null;
  return (
    <div
      className={`notice social-notice${error ? ' notice-error' : ''}`}
      role={error ? 'alert' : 'status'}
    >
      <span>{children}</span>
      {onRetry && (
        <AppButton
          className="btn btn-secondary"
          onClick={() => {
            void Promise.resolve(onRetry()).catch(() => {});
          }}
        >
          Повторить
        </AppButton>
      )}
    </div>
  );
}

export function ProfileAvatar({ profile, large = false }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [profile?.avatar]);
  const initials = (profile?.name || profile?.username || '?')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => Array.from(word)[0])
    .join('')
    .toLocaleUpperCase('ru');
  return (
    <span className={`social-avatar${large ? ' social-avatar-large' : ''}`} aria-hidden="true">
      {profile?.avatar && !failed ? (
        <img src={profile.avatar} alt="" loading="lazy" onError={() => setFailed(true)} />
      ) : (
        initials
      )}
    </span>
  );
}

export function SocialAccessNote({ requireProfile = true }) {
  const social = useSocial();
  if (!social.ready)
    return (
      <p className="footnote" role="status">
        Проверяем аккаунт…
      </p>
    );
  if (social.requiresHttps)
    return (
      <SocialNotice>
        Для входа с телефона нужен HTTPS. На компьютере откройте сайт через localhost.
      </SocialNotice>
    );
  if (!social.configured)
    return (
      <SocialNotice>
        Сообщество будет доступно после подключения базы и сервиса аккаунтов. Личный гардероб
        продолжает работать.
      </SocialNotice>
    );
  if (!social.user)
    return (
      <div className="social-access-note">
        <p>Войдите, чтобы делиться образами, добавлять друзей и общаться.</p>
        <Link className="btn btn-primary" href="/account">
          Войти или зарегистрироваться
        </Link>
      </div>
    );
  if (requireProfile && !social.profile)
    return (
      <div className="social-access-note">
        <p>Создайте профиль с именем и уникальным ником, чтобы участвовать в сообществе.</p>
        <Link className="btn btn-primary" href="/community?tab=profile">
          Создать профиль
        </Link>
      </div>
    );
  return null;
}

export function useSocialCollection(action, input, field, { enabled = true } = {}) {
  const { request, user } = useSocial();
  const inputKey = JSON.stringify(input || {});
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(enabled);
  const [moreLoading, setMoreLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const resourceKey = JSON.stringify([action, inputKey, enabled, user?.id || '', revision]);
  const [owner, setOwner] = useState('');
  const generation = useRef(0);
  const active = useRef(null);
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    const ticket = ++generation.current;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setData(null);
    setOwner(resourceKey);
    setError('');
    setMoreLoading(false);
    setLoading(enabled);
    if (enabled) {
      request(action, JSON.parse(inputKey), { signal: controller.signal })
        .then((result) => {
          if (ticket === generation.current && !controller.signal.aborted) setData(result);
        })
        .catch((cause) => {
          if (ticket === generation.current && cause.name !== 'AbortError')
            setError(cause.message || 'Не удалось загрузить данные.');
        })
        .finally(() => {
          if (ticket === generation.current && !controller.signal.aborted) setLoading(false);
        });
    }
    return () => {
      controller.abort();
      generation.current++;
    };
  }, [action, inputKey, enabled, request, user?.id, revision]);

  async function loadMore() {
    if (!data?.nextCursor || loading || moreLoading) return;
    const ticket = generation.current;
    const controller = new AbortController();
    active.current = controller;
    setMoreLoading(true);
    setError('');
    try {
      const result = await request(
        action,
        { ...JSON.parse(inputKey), cursor: data.nextCursor },
        { signal: controller.signal },
      );
      if (ticket !== generation.current || controller.signal.aborted) return;
      setData((current) => {
        if (!current) return result;
        const merged = new Map(
          [...(current[field] || []), ...(result[field] || [])].map((value) => [value.id, value]),
        );
        return { ...result, [field]: [...merged.values()] };
      });
    } catch (cause) {
      if (ticket === generation.current && cause.name !== 'AbortError')
        setError(cause.message || 'Не удалось загрузить ещё.');
    } finally {
      if (ticket === generation.current) setMoreLoading(false);
    }
  }
  const visible = owner === resourceKey;
  return {
    data: visible ? data : null,
    setData,
    loading: visible ? loading : enabled,
    moreLoading: visible ? moreLoading : false,
    error: visible ? error : '',
    reload,
    loadMore,
  };
}

export function ReportDialog({ targetType, targetId, onClose }) {
  const { request } = useSocial();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [receipt, setReceipt] = useState('');
  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await request('reports.create', {
        targetType,
        targetId,
        reason: reason.trim(),
      });
      setReceipt(result.id);
    } catch (cause) {
      if (cause.name !== 'AbortError') setError(cause.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Сообщить о нарушении" onClose={busy ? () => {} : onClose}>
      {receipt ? (
        <>
          <SocialNotice>
            Жалоба сохранена. Номер обращения: {receipt}. Это подтверждение отправки, решение по ней
            ещё не принято.
          </SocialNotice>
          <AppButton className="btn btn-secondary" onClick={onClose}>
            Закрыть
          </AppButton>
        </>
      ) : (
        <form onSubmit={submit}>
          <Field
            label="Что произошло?"
            hint="Опишите причину. Не указывайте пароли и другие секретные данные."
          >
            <textarea
              name="reason"
              required
              minLength={5}
              maxLength={1000}
              rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={busy}
              autoFocus
            />
          </Field>
          <SocialNotice error>{error}</SocialNotice>
          <div className="form-actions">
            <AppButton className="btn btn-secondary" onClick={onClose} disabled={busy}>
              Отмена
            </AppButton>
            <AppButton
              type="submit"
              className="btn btn-primary"
              disabled={busy || reason.trim().length < 5}
            >
              {busy ? 'Отправляем…' : 'Отправить жалобу'}
            </AppButton>
          </div>
        </form>
      )}
    </Modal>
  );
}

export function ShareDialog({ path, title = 'Поделиться ссылкой', onClose }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const input = useRef(null);
  const url = typeof window === 'undefined' ? path : new URL(path, window.location.origin).href;
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setError('');
    } catch {
      input.current?.focus();
      input.current?.select();
      setError('Скопируйте выделенную ссылку вручную.');
    }
  }
  return (
    <Modal title={title} onClose={onClose}>
      <Field label="Ссылка">
        <input ref={input} readOnly value={url} onFocus={(event) => event.target.select()} />
      </Field>
      <p className="footnote">
        Доступ определяется настройками профиля и публикации. Ссылка с localhost открывается на этом
        компьютере. Для другого устройства используйте адрес из раздела «На устройствах».
      </p>
      <SocialNotice>{copied ? 'Ссылка скопирована.' : error}</SocialNotice>
      <div className="form-actions">
        <AppButton className="btn btn-secondary" onClick={onClose}>
          Закрыть
        </AppButton>
        <AppButton className="btn btn-primary" onClick={copy}>
          <Icon name="copy" />
          Скопировать
        </AppButton>
      </div>
    </Modal>
  );
}

export function PersonActions({ person, onChanged, includeMenu = false }) {
  const social = useSocial();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [report, setReport] = useState(false);
  const self = person.relationship === 'self' || social.user?.id === person.id;
  if (self) return null;
  const active = !!social.user && !!social.profile;
  async function action(name, extra = {}) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await social.request(name, { userId: person.id, ...extra });
      onChanged?.();
      void social.refresh({ quiet: true }).catch(() => {});
    } catch (cause) {
      if (cause.name !== 'AbortError') setError(cause.message);
      throw cause;
    } finally {
      setBusy(false);
    }
  }
  function run(name, extra) {
    void action(name, extra).catch(() => {});
  }
  const relation = person.relationship;
  const canMessage =
    active &&
    !person.blockedByMe &&
    relation !== 'blocked' &&
    (relation === 'friends' || person.allowMessages === 'everyone');
  return (
    <>
      <div className="social-person-actions">
        {!active ? (
          <Link
            className="btn btn-secondary"
            href={social.user ? '/community?tab=profile' : '/account'}
          >
            {social.user ? 'Создать профиль' : 'Войти для общения'}
          </Link>
        ) : person.blockedByMe ? (
          <AppButton
            className="btn btn-secondary"
            disabled={busy}
            onClick={() => run('users.block', { blocked: false })}
          >
            Разблокировать
          </AppButton>
        ) : (
          <>
            {relation === 'incoming' ? (
              <>
                <AppButton
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => run('friends.accept')}
                >
                  Принять заявку
                </AppButton>
                <AppButton
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => run('friends.reject')}
                >
                  Отклонить
                </AppButton>
              </>
            ) : relation === 'outgoing' ? (
              <AppButton
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => run('friends.cancel')}
              >
                Отменить заявку
              </AppButton>
            ) : relation === 'friends' ? (
              <AppButton
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setConfirmation('remove')}
              >
                В друзьях ✓
              </AppButton>
            ) : (
              relation !== 'blocked' && (
                <AppButton
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => run('friends.request')}
                >
                  Добавить в друзья
                </AppButton>
              )
            )}
            {canMessage && (
              <Link
                className="btn btn-secondary"
                href={`/messages?user=${encodeURIComponent(person.id)}`}
              >
                Написать
              </Link>
            )}
            {includeMenu && (
              <details className="social-more">
                <summary>Ещё</summary>
                <AppButton
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => setReport(true)}
                >
                  Пожаловаться
                </AppButton>
                <AppButton
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => setConfirmation('block')}
                >
                  Заблокировать
                </AppButton>
              </details>
            )}
          </>
        )}
      </div>
      <SocialNotice error>{error}</SocialNotice>
      {confirmation && (
        <ConfirmDialog
          title={confirmation === 'block' ? 'Заблокировать пользователя?' : 'Удалить из друзей?'}
          description={
            confirmation === 'block'
              ? `${person.name} больше не сможет отправлять вам сообщения и заявки. Текущая дружба и заявки будут удалены.`
              : `${person.name} исчезнет из списка друзей. Публикации для друзей станут недоступны.`
          }
          onClose={() => setConfirmation(null)}
          onConfirm={() =>
            action(
              confirmation === 'block' ? 'users.block' : 'friends.remove',
              confirmation === 'block' ? { blocked: true } : {},
            )
          }
        />
      )}
      {report && (
        <ReportDialog targetType="profile" targetId={person.id} onClose={() => setReport(false)} />
      )}
    </>
  );
}

export function PersonCard({ person, onChanged, actions = true }) {
  return (
    <article className="social-person-card">
      <Link
        className="social-person-identity"
        href={`/people/${encodeURIComponent(person.username)}`}
      >
        <ProfileAvatar profile={person} />
        <span>
          <strong>{person.name}</strong>
          <span className="social-handle">
            @{person.username}
            {person.private ? ' · Закрытый профиль' : ''}
          </span>
        </span>
      </Link>
      {person.bio && <p className="social-person-bio">{person.bio}</p>}
      {person.city && (
        <p className="footnote">
          <Icon name="pin" />
          {person.city}
        </p>
      )}
      {actions && <PersonActions person={person} onChanged={onChanged} />}
    </article>
  );
}

export function socialDate(value) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('ru-RU', {
        day: 'numeric',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
      }).format(date)
    : '';
}

export function socialCountWord(value, one, few, many) {
  const number = Math.abs(Number(value) || 0);
  if (number % 100 >= 11 && number % 100 <= 14) return many;
  if (number % 10 === 1) return one;
  return number % 10 >= 2 && number % 10 <= 4 ? few : many;
}
