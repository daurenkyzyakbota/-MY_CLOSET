'use client';

import Link from 'next/link';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import { useCloudSync } from '@/components/providers/cloud-sync-provider.jsx';
import { Icon } from '@/components/ui/ui.jsx';

export default function SaveIndicator({ compact = false }) {
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
  const icon = ['saved', 'local'].includes(status)
    ? 'check'
    : ['error', 'conflict'].includes(status)
      ? 'warning'
      : status === 'saving' || status === 'loading'
        ? 'refresh'
        : 'cloud';

  return (
    <Link
      href="/account"
      className={`save-indicator${compact ? ' save-indicator-header' : ''}`}
      data-save-status={status}
      title={`${label}. Открыть аккаунт и сохранение`}
      aria-label={`${label}. Открыть аккаунт и сохранение`}
    >
      <Icon name={icon} />
      <span role="status" aria-live="polite">{label}</span>
    </Link>
  );
}
