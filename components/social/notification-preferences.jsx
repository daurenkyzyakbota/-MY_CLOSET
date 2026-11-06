'use client';

import { useEffect, useRef, useState } from 'react';
import { useCloudSync } from '@/components/providers/cloud-sync-provider.jsx';
import { AppButton } from '@/components/ui/app-button.jsx';
import { Field, Icon } from '@/components/ui/ui.jsx';
import { SocialNotice } from './social-common.jsx';
import {
  browserPushSupport, browserNotificationEnabled, enableBrowserNotifications,
  disconnectBrowserNotifications, notificationRequest,
} from '@/lib/notifications/browser-client.js';

function PreferencesForm({ userId }) {
  const [settings, setSettings] = useState(null);
  const [draft, setDraft] = useState(null);
  const [enabled, setEnabled] = useState(false);
  const [supported, setSupported] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [retry, setRetry] = useState(0);
  const current = useRef(true);
  useEffect(() => {
    current.current = true;
    const controller = new AbortController();
    setSupported(!!browserPushSupport());
    void notificationRequest('preferences', userId, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        setSettings(result);
        setDraft({ ...result.preferences, ...(!result.preferencesConfigured
          ? { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' } : {}) });
        setError('');
      })
      .catch((cause) => { if (!controller.signal.aborted) setError(cause.message); });
    void browserNotificationEnabled(userId).then((value) => { if (!controller.signal.aborted) setEnabled(value); });
    return () => { current.current = false; controller.abort(); };
  }, [userId, retry]);
  async function perform(work) {
    if (busy) return;
    setBusy(true);
    setError('');
    setNotice('');
    try { await work(); }
    catch (cause) { if (current.current && cause.name !== 'AbortError') setError(cause.message); }
    finally { if (current.current) setBusy(false); }
  }
  async function save(event) {
    event.preventDefault();
    await perform(async () => {
      const result = await notificationRequest('preferences', userId, { method: 'PATCH', body: draft });
      if (!current.current) return;
      setSettings(result);
      setDraft(result.preferences);
      setNotice('Настройки уведомлений сохранены.');
    });
  }
  async function enable() {
    await perform(async () => {
      const result = await enableBrowserNotifications(userId, settings.publicKey, { isCurrent: () => current.current });
      if (!current.current) return;
      setSettings(result);
      setEnabled(true);
      setNotice('Уведомления включены на этом устройстве.');
    });
  }
  return (
    <section className="settings-card account-card">
      <p className="eyebrow">УВЕДОМЛЕНИЯ НА УСТРОЙСТВЕ</p>
      <h2>Не пропустите важное</h2>
      <p>Сообщения и напоминание о завтрашнем образе могут приходить, даже когда вкладка закрыта.</p>
      <SocialNotice error onRetry={() => setRetry((value) => value + 1)}>{error}</SocialNotice>
      {!draft ? <p role="status">Загружаем настройки…</p> : (
        <form onSubmit={save}>
          <fieldset className="form-fieldset" disabled={busy}>
            <div className="form-grid">
              <label className="account-show-password field-full">
                <input type="checkbox" checked={draft.messages} onChange={(event) => setDraft({ ...draft, messages: event.target.checked })} />
                Новые личные сообщения
              </label>
              <label className="account-show-password field-full">
                <input type="checkbox" checked={draft.outfits} onChange={(event) => setDraft({ ...draft, outfits: event.target.checked })} />
                Напомнить накануне о запланированном образе
              </label>
              <Field label="Час напоминания">
                <select value={draft.reminderHour} onChange={(event) => setDraft({ ...draft, reminderHour: Number(event.target.value) })}>
                  {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
                </select>
              </Field>
              <Field label="Часовой пояс" hint="Например, Asia/Qyzylorda или Europe/Moscow.">
                <input required maxLength={80} value={draft.timeZone} onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })} />
              </Field>
            </div>
            <p className="footnote">Напоминания используют планы, сохранённые в вашем аккаунте. На экране блокировки показывается только общее уведомление — без текста переписки, фотографий и названий образов.</p>
            <AppButton className="btn btn-secondary" type="submit" disabled={busy}>Сохранить настройки</AppButton>
          </fieldset>
        </form>
      )}
      {settings && (
        <div className="account-actions">
          {enabled ? (
            <AppButton className="btn btn-secondary" disabled={busy} onClick={() => perform(async () => {
              await disconnectBrowserNotifications(userId);
              if (current.current) { setEnabled(false); setNotice('Уведомления на этом устройстве отключены.'); }
            })}>Отключить на этом устройстве</AppButton>
          ) : (
            <AppButton className="btn btn-primary" disabled={busy || !supported || !settings.available || (!settings.preferences.messages && !settings.preferences.outfits)} onClick={enable}>
              <Icon name="bell" />Разрешить уведомления на этом устройстве
            </AppButton>
          )}
          {!settings.available && <p className="footnote">Сервис уведомлений ещё подключается. Сохранённые настройки останутся в аккаунте.</p>}
          {!supported && <p className="footnote">Этот браузер не предоставляет push-уведомления. На iPhone установите сайт на экран «Домой» и откройте его оттуда.</p>}
          {!enabled && !settings.preferences.messages && !settings.preferences.outfits && <p className="footnote">Выберите события и сохраните настройки, затем разрешите уведомления.</p>}
        </div>
      )}
      <SocialNotice>{notice}</SocialNotice>
    </section>
  );
}

export default function NotificationPreferences() {
  const { user } = useCloudSync();
  return user ? <PreferencesForm key={user.id} userId={user.id} /> : null;
}
