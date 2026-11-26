'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import FormControlLabel from '@mui/material/FormControlLabel';
import Switch from '@mui/material/Switch';
import { useCloudSync } from '@/components/providers/cloud-sync-provider.jsx';
import { useSocial } from '@/components/providers/social-provider.jsx';
import { AppButton } from '@/components/ui/app-button.jsx';
import { Field, Icon } from '@/components/ui/ui.jsx';
import { SocialNotice } from './social-common.jsx';
import {
  browserPushSupport,
  browserNotificationEnabled,
  enableBrowserNotifications,
  disconnectBrowserNotifications,
  notificationRequest,
} from '@/lib/notifications/browser-client.js';

function deviceTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

function PreferencesForm({ userId }) {
  const { profile } = useSocial();
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState(null);
  const [enabled, setEnabled] = useState(null);
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const current = useRef(true);

  useEffect(() => {
    current.current = true;
    const controller = new AbortController();
    setSupported(browserPushSupport());
    setError('');
    void notificationRequest('preferences', userId, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        const preferences = { ...result.preferences };
        if (!result.preferencesConfigured) preferences.timeZone = deviceTimeZone();
        setSettings({ ...result, preferences });
        setDraft(preferences);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause.message || 'Не удалось загрузить настройки.');
      });
    void browserNotificationEnabled(userId).then((value) => {
      if (!controller.signal.aborted) setEnabled(value);
    });
    return () => {
      current.current = false;
      controller.abort();
    };
  }, [userId, retry]);

  async function perform(action, work) {
    if (busy) return;
    setBusy(action);
    setError('');
    setNotice('');
    try {
      await work();
    } catch (cause) {
      if (current.current && cause.name !== 'AbortError')
        setError(cause.message || 'Не удалось обновить уведомления.');
    } finally {
      if (current.current) setBusy('');
    }
  }

  if (!draft) {
    return error ? (
      <SocialNotice error onRetry={() => setRetry((value) => value + 1)}>
        {error}
      </SocialNotice>
    ) : (
      <p className="footnote" role="status">Загружаем настройки…</p>
    );
  }

  const saved = settings.preferences;
  const changed = draft.messages !== saved.messages || draft.outfits !== saved.outfits ||
    (draft.outfits && (draft.reminderHour !== saved.reminderHour || draft.timeZone !== saved.timeZone));

  function update(field, value) {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setError('');
    setNotice('');
  }

  async function save(event) {
    event.preventDefault();
    if (!changed) return;
    await perform('save', async () => {
      const result = await notificationRequest('preferences', userId, {
        method: 'PATCH',
        body: {
          messages: draft.messages,
          outfits: draft.outfits,
          reminderHour: draft.outfits ? draft.reminderHour : saved.reminderHour,
          timeZone: draft.outfits ? draft.timeZone.trim() : saved.timeZone,
        },
      });
      if (!current.current) return;
      setSettings(result);
      setDraft(result.preferences);
      setNotice('Настройки уведомлений сохранены.');
    });
  }

  async function enable() {
    await perform('enable', async () => {
      const result = await enableBrowserNotifications(userId, settings.publicKey, {
        isCurrent: () => current.current,
      });
      if (!current.current) return;
      setSettings(result);
      setDraft(result.preferences);
      setEnabled(true);
      setNotice('Уведомления включены на этом устройстве.');
    });
  }

  async function disable() {
    await perform('disable', async () => {
      await disconnectBrowserNotifications(userId);
      if (!current.current) return;
      setEnabled(false);
      setNotice('Уведомления на этом устройстве отключены.');
    });
  }

  const anyEvent = saved.messages || saved.outfits;
  let deviceHint = '';
  if (!settings.available) {
    deviceHint = 'Отправка уведомлений пока недоступна. Настройки можно сохранить.';
  } else if (!supported) {
    deviceHint = 'Браузер не поддерживает уведомления. На iPhone добавьте MyCloset на экран «Домой» и откройте оттуда.';
  } else if (enabled && !anyEvent) {
    deviceHint = 'Устройство подключено. Выберите, какие уведомления получать.';
  } else if (!enabled && changed) {
    deviceHint = 'Сохраните изменения перед включением уведомлений.';
  } else if (!enabled && !anyEvent) {
    deviceHint = 'Выберите хотя бы один тип уведомлений и сохраните настройки.';
  }

  return (
    <>
      <form onSubmit={save}>
        <fieldset className="form-fieldset d-flex flex-column gap-2" disabled={!!busy}>
          <legend className="sr-only">Что получать</legend>
          <FormControlLabel
            control={<Switch checked={draft.messages} onChange={(event) => update('messages', event.target.checked)} />}
            label="Личные сообщения"
          />
          {draft.messages && profile?.notifications?.messages === false && (
            <p className="footnote">
              Чтобы получать сообщения на устройстве, включите их и в настройках уведомлений на сайте.
            </p>
          )}
          <FormControlLabel
            control={<Switch checked={draft.outfits} onChange={(event) => update('outfits', event.target.checked)} />}
            label="Напоминать об образе на завтра"
          />
          {draft.outfits && (
            <div className="d-grid gap-2 mb-2">
              <Field
                label="Во сколько напоминать"
                hint="Напомним накануне, если образ сохранён в календаре аккаунта."
              >
                <select
                  value={draft.reminderHour}
                  onChange={(event) => update('reminderHour', Number(event.target.value))}
                >
                  {Array.from({ length: 24 }, (_, hour) => (
                    <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>
                  ))}
                </select>
              </Field>
              <details>
                <summary className="footnote">Часовой пояс · {draft.timeZone || 'не выбран'}</summary>
                <Field label="Часовой пояс" className="mt-2" hint="Например, Asia/Qyzylorda или Europe/Moscow.">
                  <input
                    maxLength={80}
                    value={draft.timeZone}
                    onChange={(event) => update('timeZone', event.target.value)}
                  />
                </Field>
                <AppButton className="btn btn-secondary mt-2" onClick={() => update('timeZone', deviceTimeZone())}>
                  Использовать пояс устройства
                </AppButton>
              </details>
            </div>
          )}
          <div className="mt-2">
            <AppButton className="btn btn-primary" type="submit" disabled={!!busy || !changed}>
              {busy === 'save' ? 'Сохраняем…' : 'Сохранить настройки'}
            </AppButton>
          </div>
        </fieldset>
      </form>
      <div className="account-copy mt-4">
        <h3>На этом устройстве</h3>
        <p role="status">
          {enabled === null ? 'Проверяем разрешение…' : enabled ? 'Уведомления включены' : 'Уведомления выключены'}
        </p>
        {deviceHint && <p className="footnote">{deviceHint}</p>}
        {enabled ? (
          <AppButton className="btn btn-secondary" disabled={!!busy} onClick={disable}>
            {busy === 'disable' ? 'Отключаем…' : 'Отключить'}
          </AppButton>
        ) : (
          <AppButton
            className="btn btn-secondary"
            disabled={!!busy || enabled === null || !supported || !settings.available || !anyEvent || changed}
            onClick={enable}
          >
            <Icon name="bell" />
            {busy === 'enable' ? 'Включаем…' : 'Включить уведомления'}
          </AppButton>
        )}
      </div>
      <SocialNotice error>{error}</SocialNotice>
      <SocialNotice>{notice}</SocialNotice>
    </>
  );
}

export default function NotificationPreferences() {
  const { user, sessionLoading } = useCloudSync();
  return (
    <section
      id="notification-settings"
      className="settings-card notification-preferences"
      aria-labelledby="device-notification-heading"
      tabIndex={-1}
    >
      <h2 id="device-notification-heading">Уведомления на устройстве</h2>
      {sessionLoading ? (
        <p role="status">Проверяем аккаунт…</p>
      ) : user ? (
        <>
          <p>Выберите, что получать, даже когда сайт закрыт.</p>
          <PreferencesForm key={user.id} userId={user.id} />
        </>
      ) : (
        <>
          <p>Войдите, чтобы получать уведомления о сообщениях и напоминания об образах.</p>
          <Link className="btn btn-secondary" href="/account">Войти в аккаунт</Link>
        </>
      )}
    </section>
  );
}
