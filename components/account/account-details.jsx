'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useCloudSync } from '@/components/providers/cloud-sync-provider.jsx';
import { useSocial } from '@/components/providers/social-provider.jsx';
import { AppButton } from '@/components/ui/app-button.jsx';
import { Field, Icon, Modal } from '@/components/ui/ui.jsx';
import { ProfileEditor } from '@/components/social/profile-editor.jsx';
import { ProfileAvatar } from '@/components/social/social-common.jsx';

export default function AccountDetails() {
  const cloud = useCloudSync();
  const social = useSocial();
  const userId = cloud.user?.id || '';
  const currentOwner = useRef(userId);
  currentOwner.current = userId;
  const sequence = useRef(0);
  const [name, setName] = useState(cloud.user?.name || '');
  const [savedName, setSavedName] = useState(cloud.user?.name || '');
  const [working, setWorking] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [editingProfile, setEditingProfile] = useState(false);

  useEffect(() => {
    sequence.current++;
    setName(cloud.user?.name || '');
    setSavedName(cloud.user?.name || '');
    setEditingProfile(false);
    setError('');
    setSuccess('');
    setWorking('');
    return () => { sequence.current++; };
  }, [userId]);

  useEffect(() => {
    if (cloud.user?.name === undefined) return;
    setSavedName(cloud.user.name);
    setName((current) => current === savedName ? cloud.user.name : current);
  }, [cloud.user?.name]);

  async function save(event) {
    event.preventDefault();
    if (working || !userId) return;
    const ticket = ++sequence.current;
    const owner = userId;
    setWorking('save');
    setError('');
    setSuccess('');
    try {
      const response = await fetch('/api/account/details', {
        method: 'PATCH',
        credentials: 'same-origin',
        cache: 'no-store',
        signal: AbortSignal.timeout(20000),
        headers: { 'Content-Type': 'application/json', 'X-MyCloset-Account': owner },
        body: JSON.stringify({ name: name.trim() }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Не удалось сохранить имя.');
      if (currentOwner.current !== owner || sequence.current !== ticket) return;
      if (result.user?.id !== owner || typeof result.user.name !== 'string')
        throw new Error('Сервис не подтвердил данные аккаунта. Обновите страницу.');
      setName(result.user.name);
      setSavedName(result.user.name);
      const session = await cloud.refreshSession();
      if (currentOwner.current !== owner || sequence.current !== ticket) return;
      setSuccess(
        session?.user?.id === owner && session.user.name === result.user.name
          ? 'Имя аккаунта сохранено. Оно будет доступно после входа на другом устройстве.'
          : 'Имя сохранено. Сейчас не удалось обновить подпись аккаунта; проверьте подключение и обновите страницу.',
      );
    } catch (cause) {
      if (currentOwner.current === owner && sequence.current === ticket)
        setError(cause.message || 'Не удалось сохранить имя. Повторите попытку.');
    } finally {
      if (currentOwner.current === owner && sequence.current === ticket) setWorking('');
    }
  }

  async function sendPasswordReset() {
    if (working || !userId) return;
    const owner = userId;
    const ticket = ++sequence.current;
    setWorking('password');
    setError('');
    setSuccess('');
    try {
      await cloud.requestPasswordReset(cloud.user.email);
      if (currentOwner.current === owner && sequence.current === ticket)
        setSuccess('Запрос на смену пароля принят. Откройте письмо на своей почте и перейдите по ссылке. Проверьте также «Спам».');
    } catch (cause) {
      if (currentOwner.current === owner && sequence.current === ticket)
        setError(cause.message || 'Не удалось запросить смену пароля.');
    } finally {
      if (currentOwner.current === owner && sequence.current === ticket) setWorking('');
    }
  }

  if (!cloud.user) return null;
  return (
    <section className="settings-card account-details" aria-labelledby="account-details-title">
      <p className="eyebrow">ДАННЫЕ АККАУНТА</p>
      <h2 id="account-details-title">Редактировать аккаунт</h2>
      <div className="row g-4">
        <div className="col-12 col-lg-6">
          <form onSubmit={save} id="account-details-form">
            <fieldset className="form-fieldset" disabled={!!working || cloud.requiresHttps || !cloud.online}>
              <div className="form-grid">
                <Field label="Имя аккаунта" className="field-full">
                  <input
                    name="accountName"
                    autoComplete="name"
                    required
                    maxLength={80}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </Field>
                <Field label="Почта для входа" className="field-full" hint="Смена почты в сервисе аккаунтов пока недоступна.">
                  <input type="email" value={cloud.user.email || ''} readOnly autoComplete="email" />
                </Field>
              </div>
              <div className="form-actions">
                <AppButton type="submit" className="btn btn-primary" disabled={name.trim() === savedName || !name.trim()}>
                  <Icon name="check" />
                  {working === 'save' ? 'Сохраняем…' : 'Сохранить имя'}
                </AppButton>
                <AppButton className="btn btn-secondary" onClick={sendPasswordReset}>
                  <Icon name="lock" />
                  {working === 'password' ? 'Отправляем…' : 'Сменить пароль через почту'}
                </AppButton>
              </div>
            </fieldset>
          </form>
        </div>
        <div className="col-12 col-lg-6">
          <div className="account-copy">
            <div className="account-identity">
              <ProfileAvatar profile={social.profile || { name: cloud.user.name }} large />
              <div>
                <h3>{social.profile ? `@${social.profile.username}` : 'Профиль в сообществе'}</h3>
                <p>Фото, описание, ник и настройки общения.</p>
              </div>
            </div>
            <AppButton className="btn btn-secondary" disabled={!!working || !social.ready || !cloud.online} onClick={() => setEditingProfile(true)}>
              <Icon name="user" />
              {social.profile ? 'Редактировать профиль' : 'Создать профиль'}
            </AppButton>
            <p className="footnote">Публичное имя и описание сохраняются отдельно от имени для входа.</p>
            <Link className="btn btn-ghost" href="/settings">
              Личный профиль: город, стили и цвета
            </Link>
          </div>
        </div>
      </div>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {success && <p className="notice notice-success" role="status">{success}</p>}
      {editingProfile && (
        <Modal title={social.profile ? 'Редактировать профиль' : 'Создать профиль'} onClose={() => setEditingProfile(false)}>
          <ProfileEditor
            key={userId}
            profile={social.profile}
            onCancel={() => setEditingProfile(false)}
            onSaved={() => {
              setEditingProfile(false);
              setSuccess('Профиль сохранён. Фото и описание доступны на ваших устройствах.');
            }}
          />
        </Modal>
      )}
    </section>
  );
}
