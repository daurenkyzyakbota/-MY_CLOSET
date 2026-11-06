'use client';

import { useEffect, useState } from 'react';
import { useCloudSync } from '@/components/providers/cloud-sync-provider.jsx';
import { fetchCloudPhotoStats } from '@/lib/cloud/cloud-sync-client.js';
import { AppButton } from '@/components/ui/app-button.jsx';

const size = (bytes) => `${(bytes / 1024 / 1024).toLocaleString('ru', { maximumFractionDigits: 1 })} МБ`;

export default function CloudPhotoStorage() {
  const cloud = useCloudSync();
  const [stats, setStats] = useState(null);
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const userId = cloud.user?.id;
  useEffect(() => {
    setStats(null);
    setError('');
    if (!userId || !cloud.photoStorageReady) return;
    let active = true;
    const controller = new AbortController();
    void fetchCloudPhotoStats({ userId, signal: controller.signal })
      .then((value) => { if (active) setStats(value); })
      .catch((cause) => { if (active && cause.name !== 'AbortError') setError(cause.message); });
    return () => { active = false; controller.abort(); };
  }, [userId, cloud.photoStorageReady, cloud.connection?.revision, attempt]);
  if (!userId || !cloud.photoStorageReady) return null;
  return (
    <section className="settings-card" aria-label="Хранилище фотографий">
      <h2>Больше места для любимых вещей</h2>
      <p>Фото сохраняются отдельно от списка вещей. Они доступны только вашему аккаунту и входят в полную резервную копию.</p>
      {stats ? <p>Фотографий: {stats.count}. Использовано {size(stats.bytes)} из {size(stats.limit)}.</p>
        : <p className="footnote">{error || 'Проверяем объём фотографий…'}</p>}
      <p className="footnote">В объём входят и ранее загруженные фотографии удалённых вещей.</p>
      {error && <AppButton className="btn btn-secondary" onClick={() => setAttempt((value) => value + 1)}>Повторить проверку</AppButton>}
    </section>
  );
}
