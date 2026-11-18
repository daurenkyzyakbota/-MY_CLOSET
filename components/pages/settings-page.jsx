'use client';

import { AppButton } from '@/components/ui/app-button.jsx';
import ThemePicker from '@/components/ui/theme-picker.jsx';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import { useCloudSync } from '@/components/providers/cloud-sync-provider.jsx';
import { COLORS, MAX_BACKUP_FILE_BYTES } from '@/lib/data/model.js';
import { CityPicker } from '@/components/forms/city-picker.jsx';
import InAppNotificationPreferences from '@/components/social/in-app-notification-preferences.jsx';
import NotificationPreferences from '@/components/social/notification-preferences.jsx';
import { ConfirmDialog, Field, Icon, Loading, PageHeader } from '@/components/ui/ui.jsx';

const sections = [
  { id: 'profile-form', label: 'Профиль', icon: 'user' },
  { id: 'appearance-settings', label: 'Тема', icon: 'moon' },
  { id: 'notification-settings', label: 'Уведомления', icon: 'bell' },
  { id: 'backup-settings', label: 'Данные', icon: 'download' },
];

export default function SettingsPage() {
  const closet = useCloset();
  const cloud = useCloudSync();
  const { state, ready, saveProfile, storageMode, error: storageError } = closet;
  const [draft, setDraft] = useState(state.profile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [backupError, setBackupError] = useState('');
  const [cityOpen, setCityOpen] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [backup, setBackup] = useState(null);
  const importRef = useRef(null);
  const profileKey = JSON.stringify(state.profile);
  useEffect(() => {
    setDraft(state.profile);
  }, [profileKey]);

  async function save(event) {
    event.preventDefault();
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await saveProfile({
        ...draft,
        name: draft.name.trim(),
        city: draft.city.trim(),
        styles: draft.styles.trim(),
      });
    } catch (cause) {
      setError(cause.message);
    } finally {
      setSaving(false);
    }
  }

  function confirmImport(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBackupError('');
    if (file.size > MAX_BACKUP_FILE_BYTES) {
      setBackupError('Файл слишком большой. Максимум — ' + MAX_BACKUP_FILE_BYTES / 1024 / 1024 + ' МиБ.');
      event.target.value = '';
      return;
    }
    setBackup(file);
    setConfirmation('import');
  }

  const confirmations = {
    import: {
      title: 'Загрузить резервную копию?',
      description:
        'Локальный гардероб, фотографии, история, капсулы и поездки будут заменены выбранной копией. Синхронизация этого устройства отключится; облачная копия останется без изменений.',
      action: () =>
        closet.importBackup(backup, {
          beforeApply: async () => {
            await cloud.disconnect()?.catch(() => {});
          },
        }),
    },
    reset: {
      title: 'Удалить все данные?',
      description:
        'Вещи, образы, покупки, планы, профиль, история, капсулы и поездки будут удалены из этого браузера. Синхронизация отключится; облачная копия останется без изменений. Сначала скачайте резервную копию, если хотите оставить локальные данные.',
      action: async () => {
        await cloud.disconnect()?.catch(() => {});
        await closet.resetData();
      },
    },
  };
  const selectedConfirmation = confirmation ? confirmations[confirmation] : null;
  if (!ready) return <Loading />;

  return (
    <>
      <PageHeader title="Настройки" />
      <div className="settings-layout bootstrap-layout">
        <nav className="settings-shortcuts" aria-label="Разделы настроек">
          {sections.map(({ id, label, icon }) => (
            <a key={id} className="btn btn-secondary" href={`#${id}`}>
              <Icon name={icon} />
              {label}
            </a>
          ))}
        </nav>
        <div className="row bootstrap-settings-row align-items-start">
          <div className="col-12 col-xl-6 bootstrap-grid-col bootstrap-settings-main settings-section-stack">
            <form id="profile-form" className="settings-card" onSubmit={save} tabIndex={-1}>
              <h2>Профиль</h2>
              <div className="form-grid">
                <Field label="Имя">
                  <input
                    name="name"
                    maxLength={80}
                    autoComplete="given-name"
                    placeholder="Ваше имя"
                    value={draft.name}
                    onChange={(event) => setDraft({ ...draft, name: event.target.value })}
                  />
                </Field>
                <Field
                  label={
                    <>
                      Город <span className="optional">необязательно</span>
                    </>
                  }
                >
                  <input
                    name="city"
                    maxLength={120}
                    autoComplete="address-level2"
                    placeholder="Например, Кызылорда"
                    value={draft.city}
                    onChange={(event) =>
                      setDraft({ ...draft, city: event.target.value, location: null })
                    }
                  />
                </Field>
              </div>
              <AppButton
                type="button"
                className="btn btn-secondary"
                onClick={() => setCityOpen(true)}
              >
                <Icon name="pin" />
                {state.profile.location
                  ? 'Город для погоды: ' + state.profile.location.name
                  : 'Выбрать город для погоды'}
              </AppButton>
              <details className="settings-disclosure">
                <summary>Любимые стили и цвета</summary>
                <Field label="Любимые стили">
                  <input
                    name="styles"
                    maxLength={200}
                    placeholder="Минимализм, повседневный, классика…"
                    value={draft.styles}
                    onChange={(event) => setDraft({ ...draft, styles: event.target.value })}
                  />
                </Field>
                <fieldset className="field">
                  <legend>Любимые цвета</legend>
                  <div className="color-choices">
                    {Object.entries(COLORS).map(([key, [label, color]]) => (
                      <label className="color-choice" key={key}>
                        <input
                          type="checkbox"
                          name="colors"
                          value={key}
                          checked={draft.colors.includes(key)}
                          onChange={(event) =>
                            setDraft({
                              ...draft,
                              colors: event.target.checked
                                ? [...draft.colors, key]
                                : draft.colors.filter((value) => value !== key),
                            })
                          }
                        />
                        <span className="swatch" style={{ background: color }} />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
              </details>
              {error && (
                <p className="form-error" role="alert">
                  {error}
                </p>
              )}
              <div className="form-actions">
                <AppButton className="btn btn-primary" type="submit" disabled={saving}>
                  {saving ? 'Сохраняем…' : 'Сохранить профиль'}
                </AppButton>
              </div>
            </form>
            <section id="appearance-settings" className="settings-card theme-settings-card" tabIndex={-1}>
              <h2>Внешний вид</h2>
              <ThemePicker />
            </section>
            <section className="settings-card">
              <h2>Аккаунт и синхронизация</h2>
              <p>Подключите облачную копию, чтобы открыть один гардероб на разных устройствах.</p>
              <div className="d-flex flex-wrap gap-2">
                <Link className="btn btn-secondary" href="/account">
                  <Icon name="cloud" />
                  Открыть аккаунт
                </Link>
                <Link className="btn btn-secondary" href="/devices">
                  <Icon name="phone" />
                  Открыть на телефоне
                </Link>
              </div>
            </section>
          </div>
          <div className="col-12 col-xl-6 bootstrap-grid-col bootstrap-settings-side settings-section-stack">
            <NotificationPreferences />
            <InAppNotificationPreferences />
            <section id="backup-settings" className="settings-card" tabIndex={-1}>
              <h2>Данные и резервные копии</h2>
              <p>Скачайте копию гардероба с фотографиями, чтобы перенести или восстановить данные.</p>
              <p className="storage-status">
                {storageMode === 'persistent' ? '✓ Локальное сохранение работает.' : storageError}
              </p>
              <div className="backup-actions">
                <AppButton
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => {
                    setBackupError('');
                    try {
                      closet.exportBackup();
                    } catch (cause) {
                      setBackupError(cause.message);
                    }
                  }}
                >
                  <Icon name="download" />
                  Скачать резервную копию
                </AppButton>
                <AppButton
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => importRef.current?.click()}
                >
                  <Icon name="upload" />
                  Загрузить копию
                </AppButton>
              </div>
              <input
                ref={importRef}
                type="file"
                hidden
                accept=".json,application/json"
                onChange={confirmImport}
              />
              {backupError && <p className="form-error" role="alert">{backupError}</p>}
              <details className="settings-disclosure">
                <summary>Удаление данных</summary>
                <p className="footnote">Очистите гардероб и профиль в этом браузере.</p>
                <AppButton
                  className="btn btn-danger"
                  type="button"
                  onClick={() => setConfirmation('reset')}
                >
                  <Icon name="trash" />
                  Удалить все данные
                </AppButton>
              </details>
            </section>
            <section className="settings-card">
              <h2>Корзина и отмена</h2>
              <p>В корзине: {(state.trash || []).length}. Удалённые вещи и образы можно восстановить.</p>
              <div className="wardrobe-tools-links">
                <Link className="btn btn-secondary" href="/trash">Открыть корзину</Link>
                <AppButton className="btn btn-secondary" disabled={!closet.canUndo || closet.undoing} onClick={() => {
                  void closet.undoLastChange().catch((cause) => closet.notify(cause.message));
                }}>Отменить последнее действие</AppButton>
              </div>
              <p className="footnote">{closet.canUndo ? closet.undoLabel : 'Пока нет действия для отмены.'}</p>
            </section>
          </div>
        </div>
      </div>
      {cityOpen && <CityPicker onClose={() => setCityOpen(false)} />}
      {selectedConfirmation && (
        <ConfirmDialog
          title={selectedConfirmation.title}
          description={selectedConfirmation.description}
          onConfirm={selectedConfirmation.action}
          onClose={() => {
            setConfirmation(null);
            setBackup(null);
            if (importRef.current) importRef.current.value = '';
          }}
        />
      )}
    </>
  );
}
