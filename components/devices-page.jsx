'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { AppButton } from './app-button.jsx';
import { QrCode } from '@/lib/qrcode.js';
import { MAX_BACKUP_FILE_BYTES, validateState } from '@/lib/model.js';
import { useCloset } from './closet-provider.jsx';
import { useCloudSync } from './cloud-sync-provider.jsx';
import { ConfirmDialog, PageHeader, Icon } from './ui.jsx';

function ConnectionQr({ value }) {
  const qr = useMemo(() => {
    if (!value || value.length > 512) return null;
    try {
      const code = QrCode.encodeText(value, QrCode.Ecc.MEDIUM);
      const path = [];
      for (let y = 0; y < code.size; y++) for (let x = 0; x < code.size; x++) if (code.getModule(x, y)) path.push(`M${x + 4},${y + 4}h1v1h-1z`);
      return { size: code.size + 8, path: path.join('') };
    } catch { return null; }
  }, [value]);
  return qr ? <svg className="connection-qr" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label="QR-код ссылки на MyCloset" shapeRendering="crispEdges"><rect width={qr.size} height={qr.size} fill="#fff"/><path d={qr.path} fill="#473c3f"/></svg> : null;
}

const ACCESS_MODES = [['local', 'devices', 'В одной сети'], ['internet', 'external', 'Через интернет'], ['computer', 'copy', 'На другом ПК']];

export default function DevicesPage() {
  const { exportBackup, importBackup, notify } = useCloset();
  const cloud = useCloudSync();
  const [info, setInfo] = useState(null);
  const [selected, setSelected] = useState('');
  const [connectionError, setConnectionError] = useState('');
  const [connectionLoading, setConnectionLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [accessMode, setAccessMode] = useState(null);
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);
  const [backup, setBackup] = useState(null);
  const [transferError, setTransferError] = useState('');
  const [installMessage, setInstallMessage] = useState('');
  const installPrompt = useRef(null);
  const backupInput = useRef(null);
  const linkInput = useRef(null);
  const copiedTimer = useRef(null);
  const mode = accessMode || (info?.isHosted ? 'internet' : 'local');

  useEffect(() => {
    const available = event => { event.preventDefault(); installPrompt.current = event; };
    window.addEventListener('beforeinstallprompt', available);
    return () => { window.removeEventListener('beforeinstallprompt', available); clearTimeout(copiedTimer.current); };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    setConnectionLoading(true); setConnectionError('');
    fetch('/api/device', { signal: controller.signal, cache: 'no-store' })
      .then(async response => { if (!response.ok) throw new Error('Не удалось получить адрес подключения.'); return response.json(); })
      .then(data => {
        if (controller.signal.aborted) return;
        setInfo(data);
        setSelected(current => data.phoneUrls.includes(current) ? current : data.preferredPhoneUrl || data.phoneUrls[0] || '');
      })
      .catch(cause => { if (!controller.signal.aborted) setConnectionError(cause.message); })
      .finally(() => { clearTimeout(timeout); if (!controller.signal.aborted) setConnectionLoading(false); });
    const onTimeout = () => { setConnectionError('Не удалось получить ссылку вовремя. Попробуйте ещё раз.'); setConnectionLoading(false); };
    controller.signal.addEventListener('abort', onTimeout, { once: true });
    return () => { clearTimeout(timeout); controller.signal.removeEventListener('abort', onTimeout); controller.abort(); };
  }, [refresh]);
  useEffect(() => { setCopied(false); setManualCopy(false); clearTimeout(copiedTimer.current); }, [selected]);
  useEffect(() => { if (manualCopy) { linkInput.current?.focus(); linkInput.current?.select(); } }, [manualCopy]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(selected);
      setCopied(true); setManualCopy(false); clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied(false), 2500);
    } catch { setManualCopy(true); }
  }
  async function install() {
    if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) { setInstallMessage('MyCloset уже открыт как приложение.'); return; }
    const prompt = installPrompt.current;
    if (prompt) {
      installPrompt.current = null;
      try { await prompt.prompt(); const choice = await prompt.userChoice; setInstallMessage(choice.outcome === 'accepted' ? 'MyCloset добавлен в приложения.' : 'Установку можно повторить из меню браузера.'); }
      catch { setInstallMessage('Откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран».'); }
    } else setInstallMessage('Откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран». Если пункта нет, сохраните сайт в закладки.');
  }
  async function chooseBackup(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    setTransferError('');
    try { if (file.size > MAX_BACKUP_FILE_BYTES) throw new Error('Файл резервной копии слишком большой.'); validateState(JSON.parse(await file.text())); setBackup(file); }
    catch (cause) { setTransferError(cause instanceof SyntaxError ? 'Это не резервная копия MyCloset. Выберите скачанный JSON-файл.' : cause.message || 'Не удалось прочитать резервную копию.'); }
  }

  const showConnection = mode === 'local' || (mode === 'internet' && info?.isHosted);
  return <>
    <PageHeader title="MyCloset всегда под рукой" description="На компьютере и телефоне — выберите удобный способ открытия."/>
    <div className="devices-layout bootstrap-layout">
      <div className="row bootstrap-devices-row align-items-start">
        <div className="col-12 col-xl-6 bootstrap-grid-col bootstrap-device-main d-flex">
          <section className="settings-card device-card device-connection">
            <p className="eyebrow">НА ВАШИХ УСТРОЙСТВАХ</p>
            <h2>Как открыть MyCloset?</h2>
            <div className="device-access-switch" role="group" aria-label="Способ открытия сайта">
              {ACCESS_MODES.map(([value, icon, label]) => <AppButton key={value} type="button" className={`device-access-option${mode === value ? ' is-active' : ''}`} aria-pressed={mode === value} aria-controls="device-access-content" onClick={() => setAccessMode(value)}><Icon name={icon}/><span>{label}</span></AppButton>)}
            </div>
            <div id="device-access-content" className="device-access-content">
              {showConnection && <>
                <div className={`device-access-status${info?.isHosted ? ' is-hosted' : ''}`}><Icon name={info?.isHosted ? 'external' : 'devices'}/><span>{info?.isHosted ? 'Интернет-ссылка · открывается из любой сети' : 'Локальная ссылка · только в одной сети'}</span></div>
                <h3>{info?.isHosted ? 'Откройте ссылку на любом устройстве' : 'Подключитесь к одной сети Wi-Fi'}</h3>
                <p>{info?.isHosted ? 'Передайте ссылку или отсканируйте QR-код камерой телефона. Ваш компьютер может быть выключен.' : 'Телефон или другой компьютер должны быть подключены к той же домашней сети. Этот компьютер и сервер сайта должны оставаться включёнными.'}</p>
                {selected && <>
                  <div className="device-qr"><ConnectionQr value={selected}/></div>
                  <a className="device-url device-link device-address" href={selected} target="_blank" rel="noopener noreferrer">{selected}</a>
                  <div className="device-actions"><AppButton className="button button-primary" onClick={copy}><Icon name={copied ? 'check' : 'copy'}/>{copied ? 'Скопировано' : 'Скопировать ссылку'}</AppButton></div>
                  <span className="sr-only" role="status">{copied ? 'Ссылка скопирована' : ''}</span>
                  {manualCopy && <div className="device-manual-copy"><label htmlFor="device-copy-link">Скопируйте выделенную ссылку вручную</label><input id="device-copy-link" ref={linkInput} readOnly value={selected} onFocus={event => event.target.select()}/><p className="device-note">На компьютере нажмите Ctrl+C или ⌘C. На телефоне удерживайте ссылку и выберите «Копировать».</p></div>}
                  {info?.phoneUrls.length > 1 && <details className="device-links"><summary>Выбрать другой адрес сети</summary><p className="device-note">Если ссылка не открывается, выберите адрес вашего Wi-Fi. QR-код обновится вместе со ссылкой.</p><div className="device-address-options">{info.phoneUrls.map(value => <AppButton type="button" className={`button button-ghost${selected === value ? ' is-selected' : ''}`} key={value} aria-pressed={selected === value} onClick={() => setSelected(value)}><Icon name={selected === value ? 'check' : 'devices'}/><span>{value}</span></AppButton>)}</div></details>}
                </>}
                {connectionLoading && <p className="device-note" role="status">Получаем ссылку…</p>}
                {!connectionLoading && !selected && !connectionError && <p className="device-note">Не найден адрес домашней сети. Подключите компьютер к Wi-Fi и обновите адреса.</p>}
                {connectionError && <p className="form-error" role="alert">{connectionError}</p>}
                {!info?.isHosted && <>
                  <AppButton type="button" className="button button-ghost device-refresh" disabled={connectionLoading} onClick={() => setRefresh(current => current + 1)}><Icon name="refresh"/>{connectionLoading ? 'Проверяем сеть…' : 'Обновить адреса'}</AppButton>
                  <details className="device-troubleshooting"><summary>Ссылка не открывается?</summary><ol className="install-guide"><li>Проверьте, что оба устройства в одной сети, а сайт работает на этом компьютере.</li><li>Попробуйте другой адрес сети из списка выше. Не используйте localhost на другом устройстве.</li><li>Если Windows спрашивает о доступе Node.js к домашней сети, разрешите его.</li><li>С другого Wi-Fi или мобильного интернета нужна опубликованная интернет-ссылка.</li></ol></details>
                </>}
              </>}
              {mode === 'internet' && !info && <div className="device-internet-guide"><p className="device-note" role={connectionError ? 'alert' : 'status'}>{connectionError || 'Проверяем, есть ли у сайта интернет-ссылка…'}</p>{!connectionLoading && <AppButton className="button button-secondary" onClick={() => setRefresh(current => current + 1)}><Icon name="refresh"/>Проверить ещё раз</AppButton>}</div>}
              {mode === 'internet' && info && !info.isHosted && <div className="device-internet-guide">
                <div className="device-guide-icon"><Icon name="external" size={28}/></div>
                <h3>Одна ссылка для любого интернета</h3>
                <p>Сейчас MyCloset работает на вашем компьютере. Домашняя ссылка не откроется через другой Wi-Fi или мобильную сеть.</p>
                <ol className="install-guide"><li>Разместите проект на хостинге с поддержкой Next.js.</li><li>Получите постоянную HTTPS-ссылку.</li><li>Открывайте её с любого ПК или телефона. Ваш компьютер больше не нужен для работы сайта.</li></ol>
                <p className="device-guide-note"><Icon name="info"/>Команда npm run dev запускает локальный сервер. Для общей интернет-ссылки нужен хостинг.</p>
              </div>}
              {mode === 'computer' && <div className="device-computer-guide">
                <div className="device-guide-icon"><Icon name="devices" size={28}/></div>
                <h3>Запустите копию на другом ПК</h3>
                <ol className="install-guide"><li>Перенесите туда папку проекта и установите Node.js 24.</li><li>Откройте терминал в папке проекта и выполните:</li></ol>
                <pre className="device-commands"><code>{'npm install\nnpm run dev'}</code></pre>
                <p>Затем откройте <a href="http://localhost:3000" target="_blank" rel="noopener noreferrer">localhost:3000</a> на том компьютере. Если порт занят, используйте адрес из терминала.</p>
                <p className="device-guide-note"><Icon name="info"/>Это отдельная копия сайта. Чтобы перенести свои вещи, скачайте и загрузите резервную копию.</p>
              </div>}
            </div>
          </section>
        </div>
        <div className="col-12 col-xl-6 bootstrap-grid-col bootstrap-device-side d-flex flex-column">
          <section className="settings-card device-card">
            <p className="eyebrow">ЛЮБИМЫЙ САЙТ — НА ГЛАВНОМ ЭКРАНЕ</p><h2>Один значок. Ваш гардероб.</h2>
            <p>Добавьте MyCloset на экран телефона или в приложения на компьютере.</p>
            <AppButton className="button button-primary" onClick={install}><Icon name="plus"/>Добавить на главный экран</AppButton>
            <ol className="install-guide"><li>Откройте сайт в обычном браузере.</li><li>В меню браузера выберите «Установить приложение» или «Добавить на главный экран».</li><li>Открывайте MyCloset через новый значок.</li></ol>
            <p className="device-note">Возможности установки зависят от браузера и устройства. Значок открывает ту же ссылку: для домашнего адреса компьютер должен работать.</p>
            <p className="device-note" role="status">{installMessage}</p>
          </section>
          <section className="settings-card device-card">
            <p className="eyebrow">ВАШИ ВЕЩИ — ВАШИ ДАННЫЕ</p><h2>Перенесите свой гардероб</h2>
            <p>Без входа гардероб хранится отдельно в каждом браузере. Войдите в один аккаунт на своих устройствах и подключите синхронизацию — либо перенесите данные резервной копией.</p>
            <Link className="button button-primary" href="/account"><Icon name="cloud"/>Подключить облачный гардероб</Link>
            <p className="device-note">Для ручного переноса скачайте резервную копию на прежнем устройстве и загрузите на новом. Вместе с фотографиями и вещами сохранятся образы, покупки, планы, история носки, капсулы и поездки.</p>
            <div className="device-actions"><AppButton className="button button-secondary" onClick={() => { try { exportBackup(); } catch (cause) { notify(cause.message); } }}><Icon name="download"/>Скачать копию</AppButton><AppButton type="button" className="button button-secondary" onClick={() => backupInput.current?.click()}><Icon name="upload"/>Загрузить копию</AppButton><input ref={backupInput} hidden type="file" accept=".json,application/json" onChange={chooseBackup}/></div>
            {transferError && <p className="form-error device-transfer-error" role="alert">{transferError}</p>}
          </section>
        </div>
      </div>
    </div>
    {backup && <ConfirmDialog title="Загрузить резервную копию?" description="Локальный гардероб будет заменён копией, а синхронизация отключится. Облачная копия останется без изменений. Сначала сохраните резервную копию нынешних данных." onClose={() => setBackup(null)} onConfirm={async () => { await importBackup(backup, { beforeApply: async () => { await cloud.disconnect()?.catch(() => {}); } }); setBackup(null); }}/>}
  </>;
}
