'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import { useCloudSync } from '@/components/providers/cloud-sync-provider.jsx';
import { wardrobeSummary } from '@/lib/cloud/cloud-sync-client.js';
import { AppButton } from '@/components/ui/app-button.jsx';
import { Field, Icon, Loading, Modal, PageHeader } from '@/components/ui/ui.jsx';
import AccountSocialPanel from '@/components/social/account-social-panel.jsx';

const statuses = {
  disconnected: 'Синхронизация отключена',
  ready: 'Гардероб синхронизирован',
  syncing: 'Синхронизируем…',
  offline: 'Нет подключения к интернету',
  conflict: 'Нужно выбрать копию',
  error: 'Не удалось синхронизировать',
};
const titles = {
  signin: 'С возвращением',
  signup: 'Создайте свой аккаунт',
  forgot: 'Восстановить пароль',
  reset: 'Новый пароль',
  verify: 'Подтвердите почту',
};

export default function AccountPage() {
  const closet = useCloset();
  const cloud = useCloudSync();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [repeatPassword, setRepeatPassword] = useState('');
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [working, setWorking] = useState(false);
  const [formError, setFormError] = useState('');
  const [success, setSuccess] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  const [confirmError, setConfirmError] = useState('');

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const resetToken = params.get('token');
    if (resetToken && resetToken.length <= 2048) {
      setToken(resetToken);
      setMode('reset');
    } else if (params.get('mode') === 'signup') setMode('signup');
    if (params.get('error') === 'INVALID_TOKEN')
      setFormError('Ссылка восстановления устарела. Запросите новое письмо.');
  }, []);
  useEffect(() => {
    setPassword('');
    setRepeatPassword('');
    setShowPassword(false);
  }, [mode]);
  const busy = working || cloud.busy;
  function switchMode(value) {
    setMode(value);
    setFormError('');
    setSuccess('');
  }

  async function action(work) {
    if (busy || cloud.requiresHttps) return;
    setWorking(true);
    setFormError('');
    setSuccess('');
    try {
      return await work();
    } catch (cause) {
      if (cause.name !== 'AbortError') {
        if (
          mode === 'signin' &&
          ['EMAIL_NOT_VERIFIED', 'email_not_confirmed'].includes(cause.code)
        ) {
          setMode('verify');
          setCode('');
          setSuccess('Для входа нужно подтвердить почту. Запросите код кнопкой ниже.');
        } else setFormError(cause.message || 'Не удалось выполнить действие.');
      }
    } finally {
      setWorking(false);
    }
  }

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    if (['signup', 'reset'].includes(mode) && password !== repeatPassword) {
      setFormError('Пароли не совпадают. Проверьте оба поля.');
      return;
    }
    await action(async () => {
      if (mode === 'signin') {
        await cloud.signIn({ email: email.trim(), password });
        setPassword('');
      } else if (mode === 'signup') {
        const result = await cloud.signUp({ name: name.trim(), email: email.trim(), password });
        setPassword('');
        setRepeatPassword('');
        if (result.needsVerification) {
          setMode('verify');
          setSuccess('Аккаунт создан. Для подтверждения почты запросите код кнопкой ниже.');
        } else setSuccess('Аккаунт создан. Выберите, как подключить гардероб.');
      } else if (mode === 'forgot') {
        await cloud.requestPasswordReset(email.trim());
        setSuccess(
          'Если аккаунт с этой почтой существует, на неё придёт письмо для восстановления пароля. Проверьте также папку «Спам».',
        );
      } else if (mode === 'verify') {
        await cloud.verifyEmailCode(email.trim(), code.trim());
        setCode('');
        setMode('signin');
        setSuccess('Почта подтверждена. Теперь можно войти в аккаунт.');
      } else if (mode === 'reset') {
        await cloud.resetPassword(token, password);
        setToken('');
        setMode('signin');
        setSuccess('Пароль обновлён. Войдите с новым паролем.');
        const url = new URL(window.location.href);
        url.searchParams.delete('token');
        url.searchParams.delete('error');
        window.history.replaceState(
          window.history.state,
          '',
          `${url.pathname}${url.search}${url.hash}`,
        );
      }
    });
  }

  function confirm(kind) {
    if (!cloud.remote || busy) return;
    setConfirmError('');
    setConfirmation({
      kind,
      revision: cloud.remote.revision,
      local: wardrobeSummary(closet.state),
      remote: wardrobeSummary(cloud.remote.snapshot),
    });
  }
  async function chooseCopy() {
    if (busy || !confirmation) return;
    setWorking(true);
    setConfirmError('');
    try {
      if (confirmation.kind === 'local') await cloud.connectLocal(confirmation.revision);
      else await cloud.connectCloud(confirmation.revision);
      setConfirmation(null);
    } catch (cause) {
      if (cause.name !== 'AbortError')
        setConfirmError(cause.message || 'Не удалось подключить гардероб.');
    } finally {
      setWorking(false);
    }
  }

  if (!closet.ready || cloud.configured === null || cloud.sessionLoading) return <Loading />;
  const signedIn = cloud.user && !cloud.requiresHttps && !['verify', 'reset'].includes(mode);

  return (
    <section className="account-page">
      <PageHeader
        title="Мой аккаунт"
        description="Один гардероб на ваших устройствах. Вы сами решаете, когда подключить облако."
      />
      {cloud.requiresHttps && (
        <section className="settings-card account-https-notice" role="note">
          <Icon name="lock" />
          <h2>Для входа нужна защищённая ссылка</h2>
          <p>
            Для входа с телефона нужна HTTPS-ссылка; здесь можно работать с локальным гардеробом без
            аккаунта.
          </p>
          <div className="account-actions">
            <Link className="btn btn-secondary" href="/wardrobe">
              Открыть гардероб
            </Link>
            <Link className="btn btn-ghost" href="/devices">
              Подключить устройство
            </Link>
          </div>
        </section>
      )}
      {cloud.configured === false ? (
        <div className="settings-card account-unavailable">
          <Icon name="cloud" size={32} />
          <h2>Облако пока недоступно</h2>
          <p>
            Этот сервер ещё не подключён к сервису аккаунтов. Гардероб и все изменения продолжают
            сохраняться на этом устройстве.
          </p>
          {cloud.configError && <p className="footnote">{cloud.configError}</p>}
          <AppButton className="btn btn-secondary" onClick={closet.exportBackup}>
            <Icon name="download" />
            Скачать резервную копию
          </AppButton>
        </div>
      ) : signedIn ? (
        <>
          <AccountSocialPanel />
          <div className="row g-4 account-layout">
            <div className="col-12 col-xl-5">
              <section className="settings-card account-card">
                <div className="account-identity">
                  <span className="account-avatar">
                    <Icon name="user" size={26} />
                  </span>
                  <div>
                    <p className="eyebrow">ВАШ АККАУНТ</p>
                    <h2>{cloud.user.name || 'Мой аккаунт'}</h2>
                    <p className="account-email">{cloud.user.email}</p>
                  </div>
                </div>
                <div
                  className={`account-sync-status is-${cloud.status}`}
                  role="status"
                  aria-live="polite"
                  data-cloud-status={cloud.status}
                >
                  <Icon
                    name={
                      cloud.status === 'ready'
                        ? 'check'
                        : cloud.status === 'conflict'
                          ? 'warning'
                          : 'cloud'
                    }
                  />
                  <span>{statuses[cloud.status] || statuses.disconnected}</span>
                </div>
                {cloud.connected ? (
                  <p className="footnote">
                    Изменения сначала сохраняются здесь, затем передаются в облако. Другие
                    устройства проверяются каждые 30 секунд, пока вкладка открыта.
                  </p>
                ) : (
                  <p>
                    Вход не отправляет ваши вещи и фотографии в облако. Сначала выберите, какой
                    гардероб использовать.
                  </p>
                )}
                {cloud.remote?.updatedAt && (
                  <p className="footnote">
                    Облачная копия: {new Date(cloud.remote.updatedAt).toLocaleString('ru-RU')}
                  </p>
                )}
                {cloud.error && (
                  <p
                    className={`notice ${cloud.status === 'conflict' ? '' : 'notice-error'}`}
                    role="alert"
                  >
                    {cloud.error}
                  </p>
                )}
                {!cloud.remembered && cloud.connected && (
                  <p className="footnote">
                    Браузер не запомнил разрешение синхронизации. После обновления страницы
                    потребуется подключить её снова.
                  </p>
                )}
                {cloud.user.emailVerified === false && (
                  <p className="footnote">
                    Почта ещё не подтверждена.{' '}
                    <AppButton
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => {
                        setEmail(cloud.user.email);
                        switchMode('verify');
                      }}
                    >
                      Подтвердить почту
                    </AppButton>
                  </p>
                )}
                <div className="account-actions">
                  {cloud.connected && (
                    <AppButton
                      className="btn btn-primary"
                      disabled={busy || !cloud.online || cloud.status === 'conflict'}
                      onClick={() => action(cloud.syncNow)}
                    >
                      <Icon name="refresh" />
                      {cloud.busy ? 'Синхронизируем…' : 'Синхронизировать сейчас'}
                    </AppButton>
                  )}
                  <AppButton
                    className="btn btn-secondary"
                    disabled={busy || !cloud.online}
                    onClick={() => action(cloud.refreshRemote)}
                  >
                    <Icon name="refresh" />
                    Проверить облачную копию
                  </AppButton>
                  {cloud.connected && (
                    <AppButton className="btn btn-ghost" disabled={busy} onClick={cloud.disconnect}>
                      Отключить синхронизацию
                    </AppButton>
                  )}
                  <AppButton
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => action(cloud.signOut)}
                  >
                    Выйти из аккаунта
                  </AppButton>
                </div>
                <p className="footnote">
                  Выход и отключение синхронизации сохраняют гардероб на устройстве. На общем
                  компьютере используйте отдельный профиль браузера.
                </p>
              </section>
            </div>
            <div className="col-12 col-xl-7">
              <section className="settings-card account-card">
                <div className="section-heading">
                  <h2>
                    {cloud.status === 'conflict'
                      ? 'Какой гардероб сохранить?'
                      : cloud.connected
                        ? 'Ваши копии гардероба'
                        : 'Подключите свой гардероб'}
                  </h2>
                </div>
                {cloud.status === 'conflict' && (
                  <p className="notice">
                    На устройствах появились разные изменения. Копии не объединяются автоматически.
                    Перед выбором скачайте резервную копию этого устройства.
                  </p>
                )}
                <div className="account-copies">
                  <section className="account-copy">
                    <Icon name="monitor" />
                    <h3>На этом устройстве</h3>
                    <p>{wardrobeSummary(closet.state)}</p>
                    <AppButton className="btn btn-secondary" onClick={closet.exportBackup}>
                      <Icon name="download" />
                      Скачать резервную копию
                    </AppButton>
                  </section>
                  <section className="account-copy">
                    <Icon name="cloud" />
                    <h3>В облаке</h3>
                    <p>
                      {cloud.remote
                        ? wardrobeSummary(cloud.remote.snapshot)
                        : cloud.busy
                          ? 'Проверяем облачную копию…'
                          : 'Нажмите «Проверить облачную копию».'}
                    </p>
                    {cloud.remote && <span className="tag">Версия {cloud.remote.revision}</span>}
                  </section>
                </div>
                {(!cloud.connected || cloud.status === 'conflict') && (
                  <div className="account-connect-actions">
                    <AppButton
                      className="btn btn-primary"
                      data-cloud-choice="local"
                      disabled={busy || !cloud.remote || !cloud.online}
                      onClick={() => confirm('local')}
                    >
                      <Icon name="upload" />
                      {cloud.status === 'conflict'
                        ? 'Сохранить гардероб этого устройства'
                        : 'Загрузить мой гардероб в облако'}
                    </AppButton>
                    <AppButton
                      className="btn btn-secondary"
                      data-cloud-choice="cloud"
                      disabled={busy || !cloud.remote?.snapshot || !cloud.online}
                      onClick={() => confirm('cloud')}
                    >
                      <Icon name="download" />
                      Открыть гардероб из облака
                    </AppButton>
                  </div>
                )}
                {!cloud.connected && (
                  <p className="footnote">
                    В облачную копию входят вещи, фотографии, образы, календарь, покупки, история
                    носки, капсулы и поездки. Тема и фильтры списков остаются настройками браузера.
                  </p>
                )}
              </section>
            </div>
          </div>
        </>
      ) : (
        <div className="row g-4 account-layout">
          <div className="col-12 col-lg-6">
            <section className="settings-card account-card">
              {['signin', 'signup'].includes(mode) && (
                <div className="account-tabs" role="group" aria-label="Действие с аккаунтом">
                  {[
                    ['signin', 'Войти'],
                    ['signup', 'Регистрация'],
                  ].map(([value, label]) => (
                    <AppButton
                      key={value}
                      aria-pressed={mode === value}
                      className={`btn ${mode === value ? 'btn-primary' : 'btn-ghost'}`}
                      disabled={busy}
                      onClick={() => {
                        switchMode(value);
                      }}
                    >
                      {label}
                    </AppButton>
                  ))}
                </div>
              )}
              <h2>{titles[mode]}</h2>
              {mode === 'signup' && (
                <p className="footnote">
                  Укажите имя, почту и придумайте пароль, затем нажмите «Создать аккаунт». После
                  создания аккаунта вы сможете подтвердить почту в его настройках.
                </p>
              )}
              {mode === 'verify' && (
                <p className="footnote">
                  Код подтверждает почту уже созданного аккаунта. Если вы ещё не регистрировались,
                  сначала создайте аккаунт. Затем запросите код кнопкой ниже.
                </p>
              )}
              <form id="account-form" onSubmit={submit}>
                <fieldset className="form-fieldset" disabled={busy || cloud.requiresHttps}>
                  <div className="form-grid">
                    {mode === 'signup' && (
                      <Field label="Как к вам обращаться?" className="field-full">
                        <input
                          name="name"
                          required
                          maxLength={80}
                          autoComplete="name"
                          value={name}
                          onChange={(event) => setName(event.target.value)}
                        />
                      </Field>
                    )}
                    {mode !== 'reset' && (
                      <Field label="Электронная почта" className="field-full">
                        <input
                          name="email"
                          type="email"
                          required
                          maxLength={254}
                          autoComplete="email"
                          readOnly={mode === 'verify' && !!cloud.user}
                          value={email}
                          onChange={(event) => setEmail(event.target.value)}
                        />
                      </Field>
                    )}
                    {['signin', 'signup', 'reset'].includes(mode) && (
                      <Field
                        label={mode === 'reset' ? 'Новый пароль' : 'Пароль'}
                        className="field-full"
                        hint={mode === 'signin' ? undefined : 'Не менее 8 символов.'}
                      >
                        <input
                          name="password"
                          type={showPassword ? 'text' : 'password'}
                          required
                          minLength={8}
                          maxLength={128}
                          autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                          value={password}
                          onChange={(event) => setPassword(event.target.value)}
                        />
                      </Field>
                    )}
                    {['signup', 'reset'].includes(mode) && (
                      <Field label="Повторите пароль" className="field-full">
                        <input
                          name="repeatPassword"
                          type={showPassword ? 'text' : 'password'}
                          required
                          minLength={8}
                          maxLength={128}
                          autoComplete="new-password"
                          value={repeatPassword}
                          onChange={(event) => setRepeatPassword(event.target.value)}
                        />
                      </Field>
                    )}
                    {mode === 'verify' && (
                      <Field label="Код из письма" className="field-full">
                        <input
                          name="code"
                          inputMode="numeric"
                          autoComplete="one-time-code"
                          required
                          minLength={4}
                          maxLength={12}
                          value={code}
                          onChange={(event) => setCode(event.target.value)}
                        />
                      </Field>
                    )}
                  </div>
                  {['signin', 'signup', 'reset'].includes(mode) && (
                    <label className="account-show-password">
                      <input
                        type="checkbox"
                        checked={showPassword}
                        onChange={(event) => setShowPassword(event.target.checked)}
                      />
                      Показать пароль
                    </label>
                  )}
                </fieldset>
                {formError && (
                  <p className="notice notice-error" role="alert">
                    {formError}
                  </p>
                )}
                {cloud.authError && (
                  <p className="notice notice-error" role="alert">
                    {cloud.authError}
                    <AppButton
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => action(cloud.refreshSession)}
                    >
                      Проверить вход ещё раз
                    </AppButton>
                  </p>
                )}
                {success && (
                  <p className="notice notice-success" role="status">
                    {success}
                  </p>
                )}
                <div className="form-actions">
                  <AppButton
                    className="btn btn-primary"
                    type="submit"
                    disabled={busy || cloud.requiresHttps}
                  >
                    {working
                      ? 'Подождите…'
                      : {
                          signin: 'Войти в аккаунт',
                          signup: 'Создать аккаунт',
                          forgot: 'Отправить письмо',
                          verify: 'Подтвердить почту',
                          reset: 'Сохранить новый пароль',
                        }[mode]}
                  </AppButton>
                </div>
              </form>
              <div className="account-auth-links">
                {mode === 'signin' && (
                  <>
                    <AppButton
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => {
                        switchMode('forgot');
                      }}
                    >
                      Забыли пароль?
                    </AppButton>
                  </>
                )}
                {mode === 'verify' && (
                  <AppButton
                    className="btn btn-secondary"
                    disabled={busy || cloud.requiresHttps || !email.trim()}
                    onClick={() =>
                      action(async () => {
                        await cloud.sendVerificationCode(email.trim());
                        setSuccess(
                          'Запрос принят. Проверьте «Входящие» и «Спам». Код отправляется только для уже зарегистрированного адреса.',
                        );
                      })
                    }
                  >
                    Запросить код
                  </AppButton>
                )}
                {mode === 'verify' && (
                  <AppButton
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => switchMode('signup')}
                  >
                    Сначала создать аккаунт
                  </AppButton>
                )}
                {!['signin', 'signup'].includes(mode) && (
                  <AppButton
                    className="btn btn-ghost"
                    disabled={busy}
                    onClick={() => {
                      switchMode('signin');
                    }}
                  >
                    Вернуться ко входу
                  </AppButton>
                )}
              </div>
            </section>
          </div>
          <div className="col-12 col-lg-6">
            <section className="settings-card account-card account-intro">
              <span className="account-avatar">
                <Icon name="devices" size={28} />
              </span>
              <h2>Ваш гардероб рядом</h2>
              <p>Войдите на телефоне или другом компьютере, чтобы открыть свою облачную копию.</p>
              <ul>
                <li>Сначала выберите, какой гардероб сохранить.</li>
                <li>При одновременных изменениях сайт попросит выбрать копию.</li>
                <li>
                  В уже открытой вкладке можно редактировать локальный гардероб без интернета.
                </li>
              </ul>
              <p className="footnote">
                Аккаунт MyCloset отдельный от ChatGPT. Для работы с сайтом аккаунт ChatGPT не нужен.
              </p>
              <AppButton className="btn btn-secondary" onClick={closet.exportBackup}>
                <Icon name="download" />
                Скачать резервную копию
              </AppButton>
            </section>
          </div>
        </div>
      )}
      {signedIn && formError && (
        <p className="notice notice-error" role="alert">
          {formError}
        </p>
      )}
      {signedIn && success && (
        <p className="notice notice-success" role="status">
          {success}
        </p>
      )}
      {confirmation && (
        <Modal
          title={
            confirmation.kind === 'local'
              ? 'Сохранить этот гардероб в облаке?'
              : 'Открыть облачный гардероб?'
          }
          onClose={() => {
            if (!working) setConfirmation(null);
          }}
        >
          <p className="confirm-copy">
            {confirmation.kind === 'local'
              ? 'Текущая облачная копия будет заменена гардеробом этого устройства, включая фотографии. Это разрешит дальнейшую автоматическую синхронизацию.'
              : 'Гардероб на этом устройстве будет полностью заменён облачной копией. Несохранённые в облаке местные данные не объединяются с ней.'}
          </p>
          <div className="account-confirm-summaries">
            <p>
              <strong>На устройстве:</strong> {confirmation.local}
            </p>
            <p>
              <strong>В облаке:</strong> {confirmation.remote}
            </p>
          </div>
          <AppButton className="btn btn-secondary" onClick={closet.exportBackup}>
            <Icon name="download" />
            Сначала скачать резервную копию
          </AppButton>
          {confirmError && (
            <p className="notice notice-error" role="alert">
              {confirmError}
            </p>
          )}
          <div className="form-actions">
            <AppButton
              className="btn btn-secondary"
              disabled={working}
              onClick={() => setConfirmation(null)}
            >
              Отмена
            </AppButton>
            <AppButton className="btn btn-primary" disabled={busy} onClick={chooseCopy}>
              {working ? 'Подключаем…' : 'Подтвердить выбор'}
            </AppButton>
          </div>
        </Modal>
      )}
    </section>
  );
}
