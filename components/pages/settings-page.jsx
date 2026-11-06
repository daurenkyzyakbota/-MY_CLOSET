'use client';

import { AppButton } from '@/components/ui/app-button.jsx';
import ThemePicker from '@/components/ui/theme-picker.jsx';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import { useCloudSync } from '@/components/providers/cloud-sync-provider.jsx';
import { COLORS, MAX_BACKUP_FILE_BYTES } from '@/lib/data/model.js';
import { CityPicker } from '@/components/forms/city-picker.jsx';
import { ConfirmDialog, Field, Icon, Loading, PageHeader } from '@/components/ui/ui.jsx';

export default function SettingsPage() {
  const closet = useCloset();
  const cloud = useCloudSync();
  const { state, ready, saveProfile, storageMode, error: storageError } = closet;
  const [draft, setDraft] = useState(state.profile);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
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
    if (file.size > MAX_BACKUP_FILE_BYTES) {
      setError('Файл слишком большой. Максимум — ' + MAX_BACKUP_FILE_BYTES / 1024 / 1024 + ' МиБ.');
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
      <PageHeader title="Настройки" description="Сделайте MyCloset немного ближе к себе." />
      <div className="settings-layout bootstrap-layout">
        <div className="row bootstrap-settings-row align-items-start">
          <div className="col-12 col-xl-6 bootstrap-grid-col bootstrap-settings-main d-flex">
            <form id="profile-form" className="settings-card" onSubmit={save}>
              <p className="eyebrow">ЛИЧНЫЙ ПРОФИЛЬ</p>
              <h2>Как к вам обращаться?</h2>
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
                <Field
                  label={
                    <>
                      Любимые стили <span className="optional">необязательно</span>
                    </>
                  }
                  className="full-width"
                >
                  <input
                    name="styles"
                    maxLength={200}
                    placeholder="Минимализм, повседневный, классика…"
                    value={draft.styles}
                    onChange={(event) => setDraft({ ...draft, styles: event.target.value })}
                  />
                </Field>
              </div>
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
              <p className="footnote">
                Для точной погоды выберите город из поиска. Предпочтения профиля сохраняются для
                вас; стиль образа задаётся в стилисте.
              </p>
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
          </div>
          <div className="settings-side col-12 col-xl-6 bootstrap-grid-col bootstrap-settings-side d-flex flex-column">
            <section className="settings-card theme-settings-card">
              <p className="eyebrow">В ВАШЕМ СТИЛЕ</p>
              <h2>Внешний вид</h2>
              <p>Выберите тему. Системная меняется вместе с настройками устройства.</p>
              <ThemePicker />
              <p className="footnote">
                Выбор сохраняется в этом браузере и применяется ко всем разделам сайта.
              </p>
            </section>
            <section className="settings-card">
              <p className="eyebrow">ВАШ ГАРДЕРОБ — РЯДОМ</p>
              <h2>Аккаунт и синхронизация</h2>
              <p>
                Подключите облачную копию, чтобы пользоваться одним гардеробом на телефоне и
                компьютере. При первом входе вы сами выбираете, какие данные перенести.
              </p>
              <Link className="btn btn-secondary" href="/account">
                <Icon name="cloud" />
                Открыть аккаунт
              </Link>
            </section>
            <section className="settings-card">
              <p className="eyebrow">БЛИЖЕ К ВАМ</p>
              <h2>На компьютере и телефоне</h2>
              <p>Откройте ссылку, отсканируйте QR-код и добавьте MyCloset на главный экран.</p>
              <Link className="btn btn-secondary" href="/devices">
                <Icon name="phone" />
                Открыть на телефоне
              </Link>
            </section>
            <section className="settings-card">
              <p className="eyebrow">ВАШИ ДАННЫЕ</p>
              <h2>Всегда под рукой</h2>
              <p>
                Локальная копия гардероба хранится в этом браузере. Для синхронизации между
                устройствами войдите в аккаунт и подключите облачный гардероб. Очистка данных
                браузера удаляет локальную копию.
              </p>
              <p className="storage-status">
                {storageMode === 'persistent' ? '✓ Локальное сохранение работает.' : storageError}
              </p>
              <div className="backup-actions">
                <AppButton
                  className="btn btn-secondary"
                  type="button"
                  onClick={() => {
                    setError('');
                    try {
                      closet.exportBackup();
                    } catch (cause) {
                      setError(cause.message);
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
              <p className="footnote">
                Копия содержит профиль, фотографии, вещи, образы, покупки, планы, историю носки,
                капсулы и поездки. Сохраняйте её время от времени.
              </p>
            </section>
            <section className="settings-card">
              <p className="eyebrow">ЧИСТЫЙ ЛИСТ</p>
              <h2>Начать заново</h2>
              <p>Удалить гардероб, образы, покупки, календарь и профиль из этого браузера.</p>
              <AppButton
                className="btn btn-danger"
                type="button"
                onClick={() => setConfirmation('reset')}
              >
                <Icon name="trash" />
                Удалить все данные
              </AppButton>
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
