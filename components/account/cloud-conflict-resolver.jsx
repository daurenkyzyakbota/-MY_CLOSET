'use client';

import { useEffect, useMemo, useState } from 'react';
import { useCloudSync } from '@/components/providers/cloud-sync-provider.jsx';
import { mergeWardrobes, conflictLabel } from '@/lib/cloud/cloud-merge.js';
import { wardrobeSummary } from '@/lib/cloud/cloud-sync-client.js';
import { AppButton } from '@/components/ui/app-button.jsx';

function Value({ value, missing }) {
  if (missing) return <span>Удалено</span>;
  if (value?.status === 'active') return <span>Оставить в гардеробе: {value.record.name}</span>;
  if (value?.status === 'trash') return <span>Переместить в корзину: {value.entry.record.name}</span>;
  if (typeof value === 'string' && value.startsWith('data:image/'))
    return <img src={value} alt="Вариант фотографии" width="80" height="80" style={{ objectFit: 'contain' }} />;
  if (value === null) return <span>Не указано</span>;
  if (typeof value === 'boolean') return <span>{value ? 'Да' : 'Нет'}</span>;
  if (typeof value === 'object') {
    const text = value?.name || value?.title || JSON.stringify(value, (key, entry) => key === 'photo' ? '[фотография]' : entry);
    return <span style={{ overflowWrap: 'anywhere' }}>{text.length > 240 ? `${text.slice(0, 240)}…` : text}</span>;
  }
  return <span style={{ overflowWrap: 'anywhere' }}>{String(value)}</span>;
}

export default function CloudConflictResolver() {
  const cloud = useCloudSync();
  const preview = cloud.conflictPreview;
  const [choices, setChoices] = useState({});
  const [error, setError] = useState('');
  useEffect(() => { setChoices({}); setError(''); }, [preview]);
  const result = useMemo(() => preview?.base && preview.cloud
    ? mergeWardrobes(preview.base, preview.local, preview.cloud, choices) : null,
  [preview, choices]);
  if (cloud.status !== 'conflict') return null;
  async function perform(action) {
    setError('');
    try { await action(); } catch (cause) { setError(cause.message); }
  }
  return (
    <section aria-labelledby="merge-title" className="account-copy">
      <h3 id="merge-title">Объединить изменения</h3>
      <p>Изменения разных вещей и разных полей соединятся. Для спорных значений выберите вариант; сохранение начнётся только после вашего подтверждения.</p>
      <AppButton className="btn btn-secondary" disabled={cloud.busy || !cloud.online} onClick={() => perform(cloud.prepareConflict)}>
        {cloud.busy ? 'Проверяем…' : preview ? 'Проверить изменения заново' : 'Сравнить изменения'}
      </AppButton>
      {preview && !result && <p className="notice" role="status">На этом устройстве нет подходящей базовой версии для точного объединения. Скачайте резервную копию и выберите целый гардероб ниже. После следующего успешного сохранения база будет доступна.</p>}
      {result && (
        <>
          <p role="status">{result.conflicts.length ? `Спорных изменений: ${result.conflicts.length}. Осталось выбрать: ${result.unresolved}.` : 'Спорных полей нет. Независимые изменения объединены в предварительную копию.'}</p>
          {result.conflicts.map((conflict, index) => (
            <fieldset key={conflict.id} className="account-copy" disabled={cloud.busy}>
              <legend>{conflictLabel(conflict)}</legend>
              <div className="row g-3">
                {['local', 'cloud'].map((side) => (
                  <label key={side} className="col-12 col-sm-6">
                    <span className="d-flex align-items-center gap-2">
                      <input type="radio" name={`merge-choice-${index}`} value={side} checked={choices[conflict.id] === side} onChange={() => setChoices((current) => ({ ...current, [conflict.id]: side }))} />
                      <strong>{side === 'local' ? 'На этом устройстве' : 'В облаке'}</strong>
                    </span>
                    <Value value={conflict[side]} missing={conflict[`${side}Missing`]} />
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <p><strong>После объединения:</strong> {wardrobeSummary(result.snapshot)}</p>
          <AppButton className="btn btn-primary" disabled={cloud.busy || !cloud.online || result.unresolved > 0} onClick={() => perform(() => cloud.resolveConflict(choices))}>
            Подтвердить и сохранить объединение
          </AppButton>
        </>
      )}
      {error && <p className="notice notice-error" role="alert">{error}</p>}
    </section>
  );
}
