'use client';

import Link from 'next/link';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import { useCloudSync } from '@/components/providers/cloud-sync-provider.jsx';
import { Icon } from '@/components/ui/ui.jsx';

export default function SaveIndicator() {
  const closet = useCloset();
  const cloud = useCloudSync();
  const status = !closet.ready || cloud.sessionLoading
    ? 'loading'
    : closet.storageMode === 'memory'
      ? 'error'
      : cloud.saveStatus || 'local';
  const label = status === 'loading'
    ? 'Открываем гардероб…'
    : closet.storageMode === 'memory'
      ? 'Только до закрытия страницы'
      : cloud.saveMessage || 'Сохранено на устройстве';
  const detail = !closet.ready || cloud.sessionLoading
    ? 'Проверяем, где сохранены ваши вещи.'
    : closet.storageMode === 'memory'
      ? 'Скачайте резервную копию: браузер временно не сохраняет данные.'
      : cloud.configured === false
        ? 'Облачное сохранение пока недоступно на этом сервере.'
        : status === 'conflict'
          ? 'Сравните копии в аккаунте, чтобы объединить изменения.'
          : status === 'error'
            ? 'Откройте аккаунт, чтобы проверить синхронизацию.'
            : status === 'offline'
              ? 'Изменения синхронизируются после восстановления сети.'
              : cloud.connected
                ? 'Войдите с этой почтой на другом устройстве, чтобы открыть гардероб.'
                : 'Подключите аккаунт, чтобы открывать гардероб на других устройствах.';
  const href = cloud.user && cloud.user.emailVerified !== false && !cloud.requiresHttps
    ? '/account#cloud-sync'
    : '/account';
  const accessibleLabel = [label, detail, 'Открыть настройки аккаунта и синхронизации.'].join(' ');

  return (
    <Link
      href={href}
      className="save-indicator"
      data-save-status={status}
      title={accessibleLabel}
      aria-label={accessibleLabel}
    >
      <Icon name={
        ['saved', 'local'].includes(status)
          ? 'check'
          : ['error', 'conflict'].includes(status)
            ? 'warning'
            : status === 'saving' || status === 'loading'
              ? 'refresh'
              : 'cloud'
      } />
      <span className="save-indicator-content">
        <span className="save-indicator-label" role="status" aria-live="polite">{label}</span>
        <span className="save-indicator-help">{detail}</span>
      </span>
    </Link>
  );
}
