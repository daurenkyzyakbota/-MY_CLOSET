'use client';

import { useId } from 'react';
import { CATEGORIES, COLORS, SUBCATEGORIES } from '@/lib/data/model.js';
import { normalizePhotoSuggestions } from '@/lib/media/garment-photo-autofill.js';
import { AppButton } from '@/components/ui/app-button.jsx';
import { Icon } from '@/components/ui/ui.jsx';

export const PHOTO_SUGGESTION_COPY =
  'Фото обрабатывается на устройстве. Для первой загрузки модели может понадобиться до 40 МБ трафика.';
export { photoAutofillPatch } from '@/lib/media/garment-photo-autofill.js';

const progressLabels = {
  colors: 'Ищем основные цвета…',
  'loading-model': 'Загружаем модель распознавания…',
  category: 'Подбираем категорию…',
};
const autofillLabels = {
  name: 'название',
  category: 'категория',
  subcategory: 'тип',
  colors: 'цвета',
};

export async function getPhotoSuggestions(photo, options) {
  const { analyzeGarmentPhoto } = await import('@/lib/media/garment-photo-analysis.js');
  return normalizePhotoSuggestions(await analyzeGarmentPhoto(photo, options));
}

export default function GarmentPhotoSuggestions({
  analysis,
  draft,
  onAnalyze,
  onCancel,
  onCategory,
  onColor,
  onType,
  onName,
  onUndo,
  autoApplied = [],
  disabled,
  compact = false,
}) {
  const titleId = useId();
  const statusId = useId();
  const result = analysis?.result;
  const busy = analysis?.pending === true;
  const hasSuggestions = result && (result.categories.length > 0 || result.colors.length > 0);
  const filled = ['name', 'category', 'subcategory', 'colors']
    .filter((key) => autoApplied.includes(key))
    .map((key) => autofillLabels[key]);

  return (
    <section
      className={`garment-photo-suggestions${compact ? ' is-compact' : ''}`}
      aria-labelledby={titleId}
    >
      <p id={titleId} className={compact && !analysis ? 'sr-only' : 'garment-suggestion-title'}>
        Подсказки по фото
      </p>
      {!compact && <p className="field-hint">{PHOTO_SUGGESTION_COPY}</p>}
      {(busy || !result || !hasSuggestions || result.categoryUnavailable) && (
        <div className="garment-suggestion-actions">
          {busy ? (
            <>
              <p id={statusId} className="field-hint" role="status">
                {progressLabels[analysis.stage] || 'Готовим фотографию к анализу…'}
              </p>
              {onCancel && (
                <AppButton
                  className="button button-ghost"
                  onClick={onCancel}
                  aria-describedby={statusId}
                >
                  Отменить анализ
                </AppButton>
              )}
            </>
          ) : (
            <AppButton className="button button-secondary" disabled={disabled} onClick={onAnalyze}>
              <Icon name="sparkle" />
              {result?.categoryUnavailable && hasSuggestions
                ? 'Повторить поиск категории'
                : analysis ? 'Повторить анализ' : 'Предложить по фото'}
            </AppButton>
          )}
        </div>
      )}
      {analysis?.failed && (
        <p className="field-hint" role="status">
          Анализ не удался. Повторите попытку или заполните поля вручную.
        </p>
      )}
      {result && !hasSuggestions && (
        <p className="field-hint" role="status">
          {result.categoryUnavailable
            ? 'Модель недоступна. Укажите категорию и цвета вручную.'
            : 'По этому фото нет надёжных подсказок. Укажите категорию и цвета вручную.'}
        </p>
      )}
      {hasSuggestions && (
        <div className="garment-suggestion-results" aria-label="Предложения по фото">
          {filled.length > 0 ? (
            <div className="garment-suggestion-actions">
              <p className="field-hint" role="status">Заполнено по фото: {filled.join(', ')}.</p>
              {onUndo && (
                <AppButton className="button button-ghost" disabled={disabled} onClick={onUndo}>
                  Отменить автозаполнение
                </AppButton>
              )}
            </div>
          ) : (
            <p className={compact ? 'sr-only' : 'field-hint'} role="status">
              {compact ? 'Подсказки готовы.' : 'Проверьте подсказки и при необходимости выберите другой вариант.'}
            </p>
          )}
          {onName && result.autoFill?.name && draft.name !== result.autoFill.name && (
            <div className="garment-suggestion-options" role="group" aria-label="Предложенное название">
              <AppButton
                className="button button-secondary"
                disabled={disabled}
                onClick={() => onName(result.autoFill.name)}
              >
                {result.autoFill.name}
              </AppButton>
            </div>
          )}
          {result.categories.length > 0 ? (
            <div className="garment-suggestion-options" role="group" aria-label="Предложенные категории">
              {result.categories.map((key) => (
                <AppButton
                  key={key}
                  className="button button-secondary"
                  aria-pressed={draft.category === key}
                  disabled={disabled}
                  onClick={() => onCategory(key)}
                >
                  {CATEGORIES[key]}
                </AppButton>
              ))}
            </div>
          ) : (
            <p className="field-hint">
              {result.categoryUnavailable && 'Модель недоступна. '}
              Категорию можно выбрать вручную.
            </p>
          )}
          {onType && result.types?.length > 0 && (
            <div className="garment-suggestion-options" role="group" aria-label="Предложенные типы">
              {result.types.map((type) => (
                <AppButton
                  key={`${type.category}:${type.subcategory}`}
                  className="button button-secondary"
                  aria-pressed={draft.category === type.category && draft.subcategory === type.subcategory}
                  disabled={disabled}
                  onClick={() => onType(type)}
                >
                  {SUBCATEGORIES[type.category][type.subcategory]}
                </AppButton>
              ))}
            </div>
          )}
          {result.colors.length > 0 ? (
            <div className="garment-suggestion-options" role="group" aria-label="Предложенные цвета">
              {result.colors.map((key) => (
                <AppButton
                  key={key}
                  className="button button-secondary"
                  aria-pressed={draft.colors.includes(key)}
                  disabled={disabled}
                  onClick={() => onColor(key)}
                >
                  <span
                    className="garment-suggestion-swatch"
                    style={{ background: COLORS[key][1] }}
                    aria-hidden="true"
                  />
                  {COLORS[key][0]}
                </AppButton>
              ))}
            </div>
          ) : (
            <p className="field-hint">Цвета можно выбрать вручную.</p>
          )}
        </div>
      )}
    </section>
  );
}
