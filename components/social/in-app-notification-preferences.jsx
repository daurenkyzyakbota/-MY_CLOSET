'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useSocial } from '@/components/providers/social-provider.jsx';
import { AppButton } from '@/components/ui/app-button.jsx';
import { SocialNotice } from './social-common.jsx';

const options = [
  ['friends', 'Заявки и дружба'],
  ['messages', 'Личные сообщения'],
  ['likes', 'Лайки'],
  ['comments', 'Комментарии'],
];

function PreferenceForm({ social }) {
  const [draft, setDraft] = useState({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const preferences = social.profile.notifications;
  const current = (key) => preferences?.[key] ?? true;
  const changes = Object.fromEntries(
    Object.entries(draft).filter(([key, value]) => value !== current(key)),
  );
  const dirty = Object.keys(changes).length > 0;

  function change(key, checked) {
    setDraft((previous) => {
      const next = { ...previous };
      if (checked === current(key)) delete next[key];
      else next[key] = checked;
      return next;
    });
    setError('');
    setSaved(false);
  }

  async function save(event) {
    event.preventDefault();
    if (!dirty || busy) return;
    setBusy(true);
    setError('');
    try {
      const { profile } = await social.request(
        'notifications.preferences.save',
        { notifications: changes },
        { expectedUserId: social.user.id },
      );
      social.updateProfile(profile);
      void social.refresh({ quiet: true });
      setDraft({});
      setSaved(true);
    } catch (cause) {
      if (cause.name !== 'AbortError') setError(cause.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save}>
      <fieldset className="form-fieldset" disabled={busy}>
        <legend className="sr-only">Какие уведомления показывать в ленте</legend>
        <div className="social-notification-options">
          {options.map(([key, label]) => (
            <label className="social-check" key={key}>
              <input
                type="checkbox"
                checked={draft[key] ?? current(key)}
                onChange={(event) => change(key, event.target.checked)}
              />
              <span>{label}</span>
            </label>
          ))}
        </div>
      </fieldset>
      <SocialNotice error>{error}</SocialNotice>
      <div className="d-flex flex-wrap align-items-center gap-2 mt-3">
        <AppButton type="submit" className="btn btn-secondary" disabled={!dirty || busy}>
          {busy ? 'Сохраняем…' : 'Сохранить'}
        </AppButton>
        <span className="footnote" role="status">
          {saved ? 'Сохранено' : ''}
        </span>
      </div>
    </form>
  );
}

export default function InAppNotificationPreferences() {
  const social = useSocial();
  if (!social.user || !social.configured || social.requiresHttps) return null;
  return (
    <section className="settings-card" aria-labelledby="in-app-notification-settings">
      <h2 id="in-app-notification-settings">Уведомления на сайте</h2>
      {social.profile ? (
        <>
          <p>Выберите, какие события видеть в ленте уведомлений.</p>
          <PreferenceForm key={social.user.id} social={social} />
        </>
      ) : !social.ready ? (
        <p role="status">Загружаем настройки…</p>
      ) : social.error ? (
        <SocialNotice error onRetry={() => social.refresh()}>
          {social.error}
        </SocialNotice>
      ) : (
        <>
          <p>Чтобы настроить уведомления сообщества, создайте профиль.</p>
          <Link href="/community?tab=profile" className="btn btn-secondary">
            Создать профиль
          </Link>
        </>
      )}
    </section>
  );
}
