'use client';

import { useEffect, useRef, useState } from 'react';
import { useSocial } from '@/components/providers/social-provider.jsx';
import { AppButton } from '@/components/ui/app-button.jsx';
import { Field, Icon } from '@/components/ui/ui.jsx';
import { ProfileAvatar, SocialNotice } from './social-common.jsx';

async function avatarThumbnail(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    throw new Error('Выберите фото JPG, PNG или WebP.');
  if (file.size > 12 * 1024 * 1024) throw new Error('Фотография должна быть меньше 12 МБ.');
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight)
      throw new Error('Не удалось прочитать фотографию.');
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Браузер не поддерживает обработку фото.');
    const size = Math.min(image.naturalWidth, image.naturalHeight);
    context.drawImage(
      image,
      (image.naturalWidth - size) / 2,
      (image.naturalHeight - size) / 2,
      size,
      size,
      0,
      0,
      256,
      256,
    );
    const result = canvas.toDataURL('image/webp', 0.85);
    if (result.length > 400000)
      throw new Error('Не удалось уменьшить фото. Попробуйте другое изображение.');
    return result;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function ProfileEditor({ profile, onSaved, onCancel, inDialog = false }) {
  const social = useSocial();
  const [draft, setDraft] = useState(() => ({
    username: profile?.username || '',
    name: profile?.name || social.user?.name || '',
    bio: profile?.bio || '',
    city: profile?.city || '',
    styles: profile?.styles || '',
    private: profile?.private ?? false,
    allowMessages: profile?.allowMessages || 'friends',
  }));
  const [avatar, setAvatar] = useState(null);
  const [busy, setBusy] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');
  const generation = useRef(0);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  const set = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  async function changePhoto(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const ticket = ++generation.current;
    setProcessing(true);
    setError('');
    try {
      const result = await avatarThumbnail(file);
      if (ticket === generation.current) setAvatar(result);
    } catch (cause) {
      if (ticket === generation.current) setError(cause.message);
    } finally {
      if (ticket === generation.current) setProcessing(false);
    }
  }
  async function submit(event) {
    event.preventDefault();
    if (busy || processing) return;
    const ticket = generation.current;
    setBusy(true);
    setError('');
    try {
      const result = await social.request('profile.save', {
        ...draft,
        username: draft.username.trim().toLowerCase(),
        name: draft.name.trim(),
        bio: draft.bio.trim(),
        city: draft.city.trim(),
        styles: draft.styles.trim(),
        ...(avatar !== null ? { avatar } : {}),
      });
      if (ticket !== generation.current) return;
      social.updateProfile(result.profile);
      void social.refresh({ quiet: true }).catch(() => {});
      onSaved?.(result.profile);
    } catch (cause) {
      if (ticket === generation.current && cause.name !== 'AbortError')
        setError(cause.message || 'Не удалось сохранить профиль.');
    } finally {
      if (ticket === generation.current) setBusy(false);
    }
  }
  return (
    <form
      id="social-profile-form"
      className={'closet-profile-editor' + (inDialog ? ' is-in-dialog' : ' social-surface')}
      onSubmit={submit}
      aria-busy={busy || processing}
    >
      {!inDialog && <h2>{profile ? 'Редактировать профиль' : 'Создать профиль'}</h2>}
      <fieldset className="form-fieldset" disabled={busy || processing}>
        <div className="closet-profile-avatar-editor">
          <ProfileAvatar
            profile={{
              ...profile,
              name: draft.name,
              avatar: avatar === null ? profile?.avatar : avatar,
            }}
            large
          />
          <div>
            <h3>Фото профиля</h3>
            <div className="closet-profile-photo-actions">
              <label className="btn btn-secondary social-upload">
                <Icon name="image" />
                {processing ? 'Обрабатываем…' : 'Выбрать фото'}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={changePhoto}
                />
              </label>
              {(avatar || (avatar === null && profile?.avatar)) && (
                <AppButton className="btn btn-ghost" onClick={() => setAvatar('')}>
                  Убрать фото
                </AppButton>
              )}
            </div>
            <p className="footnote">JPG, PNG или WebP до 12 МБ.</p>
          </div>
        </div>
        <section className="closet-profile-edit-section">
          <h3>Данные профиля</h3>
          <div className="form-grid">
            <Field label="Имя в сообществе *">
              <input
                name="name"
                required
                maxLength={80}
                autoComplete="name"
                value={draft.name}
                onChange={(event) => set('name', event.target.value)}
              />
            </Field>
            <Field label="Ник *" hint="От 3 до 30 латинских букв, цифр и _. Ник используется в ссылке.">
              <input
                name="username"
                required
                minLength={3}
                maxLength={30}
                pattern="[a-z0-9_]{3,30}"
                autoCapitalize="none"
                spellCheck={false}
                autoComplete="off"
                placeholder="bota_style"
                value={draft.username}
                onChange={(event) => set('username', event.target.value.toLowerCase())}
              />
            </Field>
            <Field label="О себе" className="field-full" hint={draft.bio.length + ' из 500 символов'}>
              <textarea
                name="bio"
                maxLength={500}
                rows={3}
                placeholder="Что вдохновляет ваш стиль?"
                value={draft.bio}
                onChange={(event) => set('bio', event.target.value)}
              />
            </Field>
            <Field label="Город">
              <input
                name="city"
                maxLength={120}
                autoComplete="address-level2"
                value={draft.city}
                onChange={(event) => set('city', event.target.value)}
              />
            </Field>
            <Field label="Любимые стили">
              <input
                name="styles"
                maxLength={200}
                placeholder="Минимализм, классика, casual…"
                value={draft.styles}
                onChange={(event) => set('styles', event.target.value)}
              />
            </Field>
          </div>
        </section>
        <section className="closet-profile-edit-section">
          <h3>Конфиденциальность</h3>
          <label className="closet-profile-private-choice">
            <Icon name="lock" size={20} />
            <span>
              <strong>Закрытый профиль</strong>
              <small>
                Имя, ник и фото остаются видимыми. Описание и образы доступны принятым друзьям
                в пределах видимости публикаций.
              </small>
            </span>
            <input
              name="private"
              type="checkbox"
              checked={draft.private}
              onChange={(event) => set('private', event.target.checked)}
            />
          </label>
          <Field label="Кто может писать вам">
            <select
              name="allowMessages"
              value={draft.allowMessages}
              onChange={(event) => set('allowMessages', event.target.value)}
            >
              <option value="friends">Только друзья</option>
              <option value="everyone">Все участники</option>
            </select>
          </Field>
        </section>
      </fieldset>
      <SocialNotice error>{error}</SocialNotice>
      <div className="form-actions">
        {onCancel && (
          <AppButton className="btn btn-secondary" onClick={onCancel} disabled={busy || processing}>
            Отмена
          </AppButton>
        )}
        <AppButton type="submit" className="btn btn-primary" disabled={busy || processing}>
          {busy ? 'Сохраняем…' : profile ? 'Сохранить профиль' : 'Создать профиль'}
        </AppButton>
      </div>
    </form>
  );
}

export default ProfileEditor;
