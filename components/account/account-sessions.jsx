'use client';

import { useEffect, useRef, useState } from 'react';
import { useCloudSync } from '@/components/providers/cloud-sync-provider.jsx';
import { AppButton } from '@/components/ui/app-button.jsx';
import { Icon, Modal } from '@/components/ui/ui.jsx';

const deviceName = (agent) => {
  const device = /iPhone|iPad|iPod/.test(agent) ? 'iPhone / iPad' : /Android/.test(agent) ? 'Android' : /Windows/.test(agent) ? 'Windows' : /Macintosh/.test(agent) ? 'Mac' : /Linux/.test(agent) ? 'Linux' : 'Устройство';
  const browser = /Edg\//.test(agent) ? 'Edge' : /Firefox\//.test(agent) ? 'Firefox' : /Chrome\//.test(agent) ? 'Chrome' : /Safari\//.test(agent) ? 'Safari' : '';
  return [device, browser].filter(Boolean).join(' · ');
};
const formatDate = (value) => value ? new Date(value).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' }) : 'Нет данных';

export default function AccountSessions() {
  const cloud = useCloudSync();
  const userId = cloud.user?.id || '';
  const owner = useRef(userId);
  owner.current = userId;
  const sequence = useRef(0);
  const [sessions, setSessions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [confirmation, setConfirmation] = useState(null);
  async function request(method = 'GET', body) {
    const response = await fetch('/api/account/sessions', {
      method, credentials: 'same-origin', cache: 'no-store', signal: AbortSignal.timeout(20000),
      headers: { 'X-MyCloset-Account': userId, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let result;
    try { result = await response.json(); }
    catch { throw new Error('Сервис не подтвердил действие. Обновите список входов и повторите попытку.'); }
    if (!response.ok) {
      if (response.status === 401 && owner.current === userId) void cloud.refreshSession();
      throw new Error(result?.error || 'Не удалось проверить активные входы.');
    }
    return result;
  }
  async function refresh() {
    const id = userId;
    const ticket = ++sequence.current;
    setLoading(true);
    setError('');
    try {
      const result = await request();
      if (owner.current !== id || sequence.current !== ticket) return;
      if (!Array.isArray(result.sessions)) throw new Error('Сервис не вернул список входов.');
      setSessions(result.sessions);
    } catch (cause) {
      if (owner.current === id && sequence.current === ticket) setError(cause.message);
    } finally {
      if (owner.current === id && sequence.current === ticket) setLoading(false);
    }
  }
  useEffect(() => {
    setSessions([]);
    setConfirmation(null);
    setMessage('');
    setWorking(false);
    if (userId) void refresh();
    return () => { sequence.current++; };
  }, [userId]);
  async function revoke() {
    if (!confirmation || working) return;
    const id = userId;
    const ticket = ++sequence.current;
    setWorking(true);
    setError('');
    setMessage('');
    let failureMessage = '';
    try {
      const result = await request('POST', confirmation);
      if (owner.current !== id || sequence.current !== ticket) return;
      if (!Number.isSafeInteger(result?.revoked) || result.revoked < 0)
        throw new Error('Сервис не подтвердил закрытие входов. Обновите список.');
      setConfirmation(null);
      setMessage(`Входов закрыто: ${result.revoked}. Это устройство остаётся в аккаунте.`);
    } catch (cause) {
      if (owner.current === id && sequence.current === ticket) { failureMessage = cause.message; setError(cause.message); setConfirmation(null); }
    } finally {
      if (owner.current === id && sequence.current === ticket) {
        setWorking(false);
        // The service may have closed some sessions before a partial failure.
        await refresh();
        if (failureMessage && owner.current === id) setError(failureMessage);
      }
    }
  }
  if (!userId) return null;
  const others = sessions.filter((session) => !session.current);
  return (
    <section className="settings-card" aria-labelledby="account-sessions-title">
      <p className="eyebrow">БЕЗОПАСНОСТЬ</p>
      <h2 id="account-sessions-title">Активные входы</h2>
      <p>Устройства и браузеры, где выполнен вход в ваш аккаунт. Закрытый вход потребует снова ввести пароль; сохранённый гардероб останется в аккаунте.</p>
      <div className="form-actions">
        <AppButton className="btn btn-secondary" disabled={loading || working || !cloud.online} onClick={refresh}>{loading ? 'Проверяем…' : 'Обновить список'}</AppButton>
        <AppButton className="btn btn-secondary" disabled={loading || working || !others.length || !cloud.online} onClick={() => setConfirmation({ action: 'revoke-others' })}>Выйти на других устройствах</AppButton>
      </div>
      <div className="row g-3 mt-1">
        {sessions.map((session) => (
          <div key={session.id} className="col-12 col-lg-6">
            <article className="account-copy">
              <h3><Icon name="monitor" /> {deviceName(session.userAgent)}</h3>
              {session.current && <span className="tag">Это устройство</span>}
              <p>Вход: {formatDate(session.createdAt)}<br />Действует до: {formatDate(session.expiresAt)}</p>
              <details><summary>Подробности входа</summary><p className="footnote" style={{ overflowWrap: 'anywhere' }}>IP: {session.ipAddress || 'Нет данных'}<br />{session.userAgent || 'Браузер не сообщил сведения'}</p></details>
              {!session.current && <AppButton className="btn btn-ghost" disabled={working || loading || !cloud.online} onClick={() => setConfirmation({ action: 'revoke', sessionId: session.id })}>Закрыть этот вход</AppButton>}
            </article>
          </div>
        ))}
      </div>
      {error && <p className="notice notice-error" role="alert">{error}</p>}
      {message && <p className="notice notice-success" role="status">{message}</p>}
      {confirmation && <Modal title="Закрыть вход?" onClose={() => { if (!working) setConfirmation(null); }}>
        <p>{confirmation.action === 'revoke-others' ? 'На всех других устройствах потребуется снова войти в аккаунт.' : 'На выбранном устройстве потребуется снова войти в аккаунт.'} Текущий вход и данные гардероба сохранятся.</p>
        <div className="form-actions">
          <AppButton className="btn btn-secondary" disabled={working} onClick={() => setConfirmation(null)}>Отмена</AppButton>
          <AppButton className="btn btn-primary" disabled={working} onClick={revoke}>{working ? 'Закрываем…' : 'Подтвердить выход'}</AppButton>
        </div>
      </Modal>}
    </section>
  );
}
