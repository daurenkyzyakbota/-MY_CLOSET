'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import { useCloudSync } from '@/components/providers/cloud-sync-provider.jsx';
import { useSocial } from '@/components/providers/social-provider.jsx';
import { AppButton } from '@/components/ui/app-button.jsx';
import { ConfirmDialog, Field, Icon, Modal } from '@/components/ui/ui.jsx';

export default function AccountSocialPanel() {
  const closet = useCloset();
  const cloud = useCloudSync();
  const social = useSocial();
  const [guestCount, setGuestCount] = useState(0);
  const [copying, setCopying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [deletionAvailable, setDeletionAvailable] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/cloud/status', { cache: 'no-store', signal: controller.signal })
      .then((response) => response.json())
      .then((result) => setDeletionAvailable(result.accountDeletionAvailable === true))
      .catch(() => {});
    return () => controller.abort();
  }, []);
  useEffect(() => {
    let alive = true;
    void closet
      .readGuestWardrobe()
      .then((value) => {
        if (alive)
          setGuestCount(
            value.items.length +
              value.outfits.length +
              value.shoppingList.length +
              value.plans.length +
              value.capsules.length +
              value.trips.length +
              value.wearLog.length,
          );
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [closet.readGuestWardrobe, social.user?.id]);
  async function removeAccount(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setSuccess('');
    try {
      await cloud.disconnect()?.catch(() => {});
      const response = await fetch('/api/social/account', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { 'Content-Type': 'application/json', 'X-MyCloset-Account': social.user.id },
        body: JSON.stringify({ confirmation, password }),
        signal: AbortSignal.timeout(45000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Не удалось удалить аккаунт.');
      setPassword('');
      if (result.pendingConfirmation) {
        setSuccess('Проверьте почту и подтвердите удаление аккаунта по письму сервиса входа.');
        setDeleting(false);
        return;
      }
      await closet.resetData();
      await cloud.refreshSession();
      window.location.assign('/account?deleted=1');
    } catch (cause) {
      setError(cause.message || 'Не удалось удалить аккаунт.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section id="social-account" className="settings-card social-account-panel">
      <p className="eyebrow">ВАШ ПРОФИЛЬ В MYCLOSET</p>
      <h2>{social.profile ? `@${social.profile.username}` : 'Познакомимся поближе?'}</h2>
      <p>
        {social.profile
          ? 'Образы, друзья и переписка привязаны к этому аккаунту. Личный гардероб хранится отдельно от публикаций.'
          : 'Создайте профиль, чтобы делиться образами, находить друзей и общаться.'}
      </p>
      <div className="account-actions">
        <Link
          className="btn btn-primary"
          href={social.profile ? `/people/${social.profile.username}` : '/community?tab=profile'}
        >
          <Icon name="user" />
          {social.profile ? 'Мой профиль' : 'Создать профиль'}
        </Link>
        <Link className="btn btn-secondary" href="/community">
          Сообщество
        </Link>
      </div>
      {guestCount > 0 && (
        <div>
          <p className="footnote">
            В браузере есть отдельный локальный гардероб без входа. Его можно скопировать в этот
            аккаунт. Нынешняя копия аккаунта будет заменена; облачная сохранится.
          </p>
          <AppButton className="btn btn-secondary" disabled={busy} onClick={() => setCopying(true)}>
            Перенести локальный гардероб
          </AppButton>
        </div>
      )}
      <p className="footnote">
        После выхода откроется отдельный гардероб без аккаунта. Данные разных аккаунтов не
        смешиваются.
      </p>
      <AppButton
        className="btn btn-danger"
        disabled={!deletionAvailable}
        onClick={() => {
          setError('');
          setPassword('');
          setConfirmation('');
          setDeleting(true);
        }}
      >
        Удалить аккаунт
      </AppButton>
      {!deletionAvailable && (
        <p className="footnote">
          Удаление учётной записи станет доступно после подключения разрешённого способа управления
          аккаунтами. Публикации и комментарии можно удалять по отдельности.
        </p>
      )}
      {success && (
        <p className="notice" role="status">
          {success}
        </p>
      )}
      {error && !deleting && (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      )}
      {copying && (
        <ConfirmDialog
          title="Перенести локальный гардероб?"
          description="Вещи, образы и остальные записи этого аккаунта в браузере будут заменены локальной копией. Синхронизация отключится. Облачная и исходная локальная копии сохранятся."
          onClose={() => setCopying(false)}
          onConfirm={async () => {
            await cloud.disconnect()?.catch(() => {});
            await closet.importGuestWardrobe();
            setCopying(false);
            setSuccess('Гардероб перенесён. При желании подключите его синхронизацию ниже.');
          }}
        />
      )}
      {deleting && (
        <Modal
          title="Удалить аккаунт навсегда?"
          description="Удалятся профиль, публикации, дружба, переписки и облачный гардероб. Действие нельзя отменить. Отдельные резервные копии и гардероб без входа сохранятся."
          onClose={
            busy
              ? () => {}
              : () => {
                  setDeleting(false);
                  setPassword('');
                }
          }
        >
          <form className="social-delete-form" onSubmit={removeAccount}>
            <Field label="Пароль аккаунта">
              <input
                type="password"
                autoComplete="current-password"
                required
                minLength={8}
                maxLength={128}
                value={password}
                disabled={busy}
                onChange={(event) => setPassword(event.target.value)}
              />
            </Field>
            <Field label="Введите УДАЛИТЬ">
              <input
                required
                value={confirmation}
                disabled={busy}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </Field>
            {error && (
              <p className="notice notice-error" role="alert">
                {error}
              </p>
            )}
            <div className="form-actions">
              <AppButton
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => setDeleting(false)}
              >
                Отмена
              </AppButton>
              <AppButton
                type="submit"
                className="btn btn-danger"
                disabled={busy || confirmation !== 'УДАЛИТЬ'}
              >
                {busy ? 'Удаляем…' : 'Удалить навсегда'}
              </AppButton>
            </div>
          </form>
        </Modal>
      )}
    </section>
  );
}
