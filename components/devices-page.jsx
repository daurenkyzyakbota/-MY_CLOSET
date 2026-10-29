'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { QrCode } from '@/lib/qrcode.js';
import { MAX_BACKUP_FILE_BYTES, validateState } from '@/lib/model.js';
import { useCloset } from './closet-provider.jsx';
import { ConfirmDialog, PageHeader, Icon } from './ui.jsx';

function ConnectionQr({ value }) {
  const qr = useMemo(() => {
    if (!value || value.length > 512) return null;
    try {
      const code = QrCode.encodeText(value, QrCode.Ecc.MEDIUM);
      const path = [];
      for (let y = 0; y < code.size; y++) for (let x = 0; x < code.size; x++) if (code.getModule(x,y)) path.push(`M${x+4},${y+4}h1v1h-1z`);
      return { size: code.size + 8, path: path.join('') };
    } catch { return null; }
  }, [value]);
  return qr ? <svg className="connection-qr" viewBox={`0 0 ${qr.size} ${qr.size}`} role="img" aria-label="QR-код ссылки на MyCloset" shapeRendering="crispEdges"><rect width={qr.size} height={qr.size} fill="#fff"/><path d={qr.path} fill="#473c3f"/></svg> : null;
}

export default function DevicesPage() {
  const { exportBackup, importBackup, notify } = useCloset();
  const [info, setInfo] = useState(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [backup, setBackup] = useState(null);
  const [installMessage, setInstallMessage] = useState('');
  const installPrompt = useRef(null);
  const backupInput = useRef(null);
  useEffect(() => {
    const available = event => { event.preventDefault(); installPrompt.current = event; };
    window.addEventListener('beforeinstallprompt', available);
    return () => window.removeEventListener('beforeinstallprompt', available);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/device', { signal: controller.signal, cache: 'no-store' }).then(async response => { if (!response.ok) throw new Error('Не удалось получить адрес подключения.'); return response.json(); }).then(data => { setInfo(data); setSelected(data.phoneUrls?.[0] || ''); }).catch(error => { if (error.name !== 'AbortError') setError(error.message); });
    return () => controller.abort();
  }, []);
  async function copy() {
    try { await navigator.clipboard.writeText(selected); setCopied(true); } catch { setError('Выделите и скопируйте ссылку ниже. Браузер не разрешил копирование.'); }
  }
  async function install() {
    if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) { setInstallMessage('MyCloset уже открыт как приложение.'); return; }
    const prompt = installPrompt.current;
    if (prompt) {
      installPrompt.current = null;
      try { await prompt.prompt(); const choice = await prompt.userChoice; setInstallMessage(choice.outcome === 'accepted' ? 'MyCloset добавлен в приложения.' : 'Установку можно повторить из меню браузера.'); } catch { setInstallMessage('Откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран».'); }
    } else setInstallMessage('Откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран». Если пункта нет, сохраните сайт в закладки.');
  }
  async function chooseBackup(event) {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file) return;
    try { if (file.size > MAX_BACKUP_FILE_BYTES) throw new Error('Файл резервной копии слишком большой.'); validateState(JSON.parse(await file.text())); setBackup(file); setError(''); }
    catch (cause) { setError(cause.message || 'Не удалось прочитать резервную копию.'); }
  }
  return <><PageHeader title="MyCloset всегда под рукой" description="Открывайте свой гардероб с компьютера и телефона."/>
    <div className="devices-layout">
      <section className="settings-card device-card device-connection">
        <p className="eyebrow">{info?.isHosted ? 'ОДНА ССЫЛКА ДЛЯ ВАШИХ УСТРОЙСТВ' : 'ПОДКЛЮЧЕНИЕ ДОМА'}</p>
        <h2>{info?.isHosted ? 'С телефона — в одно касание' : 'Откройте на телефоне'}</h2>
        <p>{info?.isHosted ? 'Наведите камеру телефона на QR-код или сохраните ссылку.' : 'Подключите телефон к той же сети Wi-Fi и наведите камеру на QR-код. Для этой домашней ссылки компьютер должен быть включён.'}</p>
        {selected && <><div className="device-qr"><ConnectionQr value={selected}/></div><a className="device-url device-link device-address" href={selected} target="_blank" rel="noopener noreferrer">{selected}</a><div className="device-actions"><button className="button button-primary" onClick={copy}><Icon name={copied ? 'check' : 'copy'}/>{copied ? 'Скопировано' : 'Скопировать ссылку'}</button></div>{info.phoneUrls.length > 1 && <details className="device-links"><summary>Другие адреса домашней сети</summary><p className="device-note">Телефон и компьютер должны быть в одной сети Wi-Fi.</p>{info.phoneUrls.map(value => <button type="button" className="button button-ghost" key={value} onClick={() => { setSelected(value); setCopied(false); }}>{value}</button>)}</details>}</>}
        {!info && !error && <p className="device-note" role="status">Получаем ссылку…</p>}{info && !selected && <p className="device-note">Не удалось определить адрес Wi-Fi. Подключите компьютер к сети и обновите страницу.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
      </section>
      <div><section className="settings-card device-card"><p className="eyebrow">ЛЮБИМЫЙ САЙТ — НА ГЛАВНОМ ЭКРАНЕ</p><h2>Один значок. Ваш гардероб.</h2><p>Добавьте MyCloset на экран телефона или в приложения на компьютере.</p><button className="button button-primary" onClick={install}><Icon name="plus"/>Добавить на главный экран</button><ol className="install-guide"><li>Откройте сайт в обычном браузере.</li><li>В меню браузера выберите «Установить приложение» или «Добавить на главный экран».</li><li>Открывайте MyCloset через новый значок.</li></ol><p className="device-note">Возможности установки зависят от браузера и устройства. Для прогноза нужен интернет.</p><p className="device-note" role="status">{installMessage}</p></section>
        <section className="settings-card device-card"><p className="eyebrow">ВАШИ ВЕЩИ — ВАШИ ДАННЫЕ</p><h2>Перенесите свой гардероб</h2><p>На каждом устройстве и в каждом браузере гардероб хранится отдельно. Автоматической синхронизации пока нет.</p><p className="device-note">Скачайте резервную копию на прежнем устройстве и загрузите её на новом. Копия перенесёт фотографии, вещи, образы, покупки и планы.</p><div className="device-actions"><button className="button button-secondary" onClick={() => { try { exportBackup(); } catch(cause) { notify(cause.message); } }}><Icon name="download"/>Скачать копию</button><button type="button" className="button button-secondary" onClick={() => backupInput.current?.click()}><Icon name="upload"/>Загрузить копию</button><input ref={backupInput} hidden type="file" accept=".json,application/json" onChange={chooseBackup}/></div></section>
      </div>
    </div>{backup && <ConfirmDialog title="Загрузить резервную копию?" description="Текущий гардероб будет заменён содержимым копии. Сначала сохраните свою копию, если хотите оставить нынешние данные." onClose={() => setBackup(null)} onConfirm={async () => { await importBackup(backup); setBackup(null); }}/>}</>;
}
