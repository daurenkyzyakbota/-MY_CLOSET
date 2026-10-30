'use client';

import { useColorScheme } from '@mui/material/styles';
import { AppButton } from '@/components/ui/app-button.jsx';
import { Icon } from '@/components/ui/ui.jsx';

const choices = [
  { value: 'light', label: 'Светлая', note: 'Нежные светлые оттенки', icon: 'sun' },
  { value: 'dark', label: 'Тёмная', note: 'Мягкий свет для вечера', icon: 'moon' },
  { value: 'system', label: 'Системная', note: 'Как на вашем устройстве', icon: 'monitor' },
];

export default function ThemePicker({ compact = false }) {
  const { mode, systemMode, setMode } = useColorScheme();
  const ready = mode !== undefined;
  const effectiveMode = mode === 'system' ? systemMode : mode;

  if (compact) {
    const nextMode = effectiveMode === 'dark' ? 'light' : 'dark';
    const label = ready
      ? nextMode === 'light'
        ? 'Включить светлую тему'
        : 'Включить тёмную тему'
      : 'Изменить тему';
    return (
      <AppButton
        type="button"
        className="icon-btn theme-toggle"
        data-action="toggle-theme"
        onClick={() => setMode(nextMode)}
        disabled={!ready}
        aria-label={label}
        title={label}
      >
        <Icon name={nextMode === 'light' ? 'sun' : 'moon'} />
      </AppButton>
    );
  }

  return (
    <div className="theme-picker" role="group" aria-label="Тема сайта">
      {choices.map((choice) => (
        <AppButton
          key={choice.value}
          type="button"
          className={`theme-option${mode === choice.value ? ' is-active' : ''}`}
          data-theme-choice={choice.value}
          aria-pressed={mode === choice.value}
          disabled={!ready}
          onClick={() => setMode(choice.value)}
        >
          <span className={`theme-swatch theme-swatch-${choice.value}`} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span className="theme-option-copy">
            <strong className="theme-option-label">
              <Icon name={choice.icon} />
              {choice.label}
            </strong>
            <small className="theme-option-note">{choice.note}</small>
          </span>
          {mode === choice.value && (
            <span className="theme-option-check" aria-hidden="true">
              <Icon name="check" size={16} />
            </span>
          )}
        </AppButton>
      ))}
    </div>
  );
}
