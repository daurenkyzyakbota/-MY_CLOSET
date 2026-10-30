'use client';

import { Children, isValidElement, useEffect, useId, useState } from 'react';
import Alert from '@mui/material/Alert';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import OutlinedInput from '@mui/material/OutlinedInput';
import Select from '@mui/material/Select';
import { AppButton } from '@/components/ui/app-button.jsx';
import { COLORS } from '@/lib/data/model.js';

const icons = {
  home: (
    <>
      <path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-6v-7h-4v7H4a1 1 0 0 1-1-1Z" />
    </>
  ),
  wardrobe: (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M12 3v18m-3-11v3m6-3v3" />
    </>
  ),
  hanger: (
    <>
      <path d="M9 6a3 3 0 0 1 6 0c0 2-3 2-3 4v1L3 17a1 1 0 0 0 .5 2h17a1 1 0 0 0 .5-2l-9-6" />
    </>
  ),
  sparkle: (
    <>
      <path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4" />
    </>
  ),
  outfits: (
    <>
      <path d="m8 3 4 2 4-2 5 4-3 4-2-1v11H8V10l-2 1-3-4Z" />
      <path d="M9 3a3 3 0 0 0 6 0" />
    </>
  ),
  heart: (
    <path d="m20.8 4.6 0 0a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4m10-4v4M3 11h18m-13 4h2m4 0h2m-8 3h2" />
    </>
  ),
  shopping: (
    <>
      <path d="M6 7h12l2 14H4Zm3 0V6a3 3 0 0 1 6 0v1" />
    </>
  ),
  settings: (
    <>
      <path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21v-2a8 8 0 0 1 16 0v2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  search: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m16 16 5 5" />
    </>
  ),
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  'arrow-right': <path d="M4 12h16m-6-6 6 6-6 6" />,
  'chevron-left': <path d="m15 5-7 7 7 7" />,
  'chevron-right': <path d="m9 5 7 7-7 7" />,
  'chevron-down': <path d="m6 9 6 6 6-6" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  check: <path d="m5 12 4 4L19 6" />,
  edit: (
    <>
      <path d="m15 4 5 5M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15Z" />
      <path d="M14 20h7" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7" />
    </>
  ),
  copy: (
    <>
      <rect x="8" y="8" width="13" height="13" rx="2" />
      <path d="M16 4V3H3v13h1" />
    </>
  ),
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5" />
    </>
  ),
  moon: <path d="M20.8 13.3A9 9 0 0 1 10.7 3.2 9 9 0 1 0 20.8 13.3Z" />,
  monitor: (
    <>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21h8m-4-4v4" />
    </>
  ),
  briefcase: (
    <>
      <rect x="3" y="7" width="18" height="14" rx="2" />
      <path d="M8 7V3h8v4M3 12a25 25 0 0 0 18 0M10 13h4m-2-1v3" />
    </>
  ),
  chart: (
    <>
      <path d="M4 3v18h17M8 16v-5m5 5V6m5 10v-8" />
    </>
  ),
  cloud: <path d="M6 18a4 4 0 0 1-1-7.9A7 7 0 0 1 18.5 8 5 5 0 0 1 18 18Z" />,
  rain: (
    <>
      <path d="M6 16a4 4 0 0 1-1-7.9A7 7 0 0 1 18.5 6 5 5 0 0 1 18 16Z" />
      <path d="m8 19-1 2m6-2-1 2m6-2-1 2" />
    </>
  ),
  wind: (
    <>
      <path d="M3 8h12a3 3 0 1 0-3-3M3 12h16a3 3 0 1 1-3 3M3 16h5a3 3 0 1 1-3 3" />
    </>
  ),
  pin: (
    <>
      <path d="M19 10c0 5-7 11-7 11S5 15 5 10a7 7 0 0 1 14 0Z" />
      <circle cx="12" cy="10" r="2" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 8a8 8 0 0 0-14-3L3 8m0-5v5h5M4 16a8 8 0 0 0 14 3l3-3m0 5v-5h-5" />
    </>
  ),
  download: (
    <>
      <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5" />
    </>
  ),
  image: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="8" cy="8" r="1.5" />
      <path d="m3 17 6-6 4 4 3-3 5 5" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v.1" />
    </>
  ),
  warning: (
    <>
      <path d="m12 3 10 18H2ZM12 9v5m0 3v.1" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3m-4 4v3" />
    </>
  ),
  devices: (
    <>
      <rect x="2" y="3" width="14" height="12" rx="2" />
      <path d="M6 20h6M9 15v5" />
      <rect x="16" y="10" width="6" height="11" rx="1" />
    </>
  ),
  phone: (
    <>
      <rect x="6" y="2" width="12" height="20" rx="2.5" />
      <path d="M10 5h4m-3 14h2" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </>
  ),
  external: (
    <>
      <path d="M14 3h7v7m0-7L10 14M10 3H3v18h18v-7" />
    </>
  ),
  laundry: (
    <>
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <circle cx="12" cy="13" r="5" />
      <path d="M6 6h1m3 0h1m5 6c-3 3-5-2-8 1" />
    </>
  ),
};

export function Icon({ name = 'sparkle', size = 20, className = '', ...props }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`icon ${className}`}
      {...props}
    >
      {icons[name] || icons.sparkle}
    </svg>
  );
}

export function PageHeader({ eyebrow = 'ВАШ ЛИЧНЫЙ СТИЛЬ', title, description, children }) {
  return (
    <div className="page-header page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {description && <p className="subtitle">{description}</p>}
      </div>
      {children && <div className="page-heading-actions">{children}</div>}
    </div>
  );
}

export function EmptyState({ icon = 'hanger', title, description, children }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Icon name={icon} size={34} />
      </div>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {children}
    </div>
  );
}

export function Loading() {
  return (
    <div className="loading-state" role="status">
      <CircularProgress className="loading-progress" size={22} thickness={3} aria-hidden="true" />
      <span>Открываем ваш гардероб…</span>
    </div>
  );
}

function fieldControl(child, error, descriptionIds) {
  if (!isValidElement(child) || typeof child.type !== 'string') return child;
  const tag = child.type;
  if (!['input', 'select', 'textarea'].includes(tag)) return child;
  if (
    tag === 'input' &&
    [
      'file',
      'checkbox',
      'radio',
      'hidden',
      'button',
      'submit',
      'reset',
      'image',
      'color',
      'range',
    ].includes(child.props.type)
  )
    return child;
  const {
    children,
    className = '',
    style,
    ref,
    id,
    name,
    type,
    autoFocus,
    autoComplete,
    defaultValue,
    value,
    onChange,
    onBlur,
    onFocus,
    disabled,
    required,
    readOnly,
    placeholder,
    rows,
    ...nativeProps
  } = child.props;
  const describedBy =
    [nativeProps['aria-describedby'], ...descriptionIds].filter(Boolean).join(' ') || undefined;
  const attributes = {
    ...nativeProps,
    ...(className ? { className } : {}),
    ...(style ? { style } : {}),
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(error ? { 'aria-invalid': true } : {}),
  };
  const common = {
    id,
    name,
    autoFocus,
    autoComplete,
    defaultValue,
    value,
    onChange,
    onBlur,
    onFocus,
    disabled,
    required,
    readOnly,
    fullWidth: true,
    error: !!error,
    inputRef: ref,
    notched: false,
  };
  if (tag === 'select')
    return (
      <Select
        {...common}
        key={child.key}
        native
        variant="outlined"
        className="mui-field-control mui-native-select"
        inputProps={attributes}
      >
        {children}
      </Select>
    );
  return (
    <OutlinedInput
      {...common}
      key={child.key}
      type={tag === 'textarea' ? undefined : type || 'text'}
      placeholder={placeholder}
      multiline={tag === 'textarea'}
      rows={tag === 'textarea' ? rows : undefined}
      className={`mui-field-control${tag === 'textarea' ? ' mui-textarea-control' : ''}`}
      slotProps={{ input: attributes }}
    />
  );
}

export function Field({ label, children, className = '', hint, error, ...props }) {
  const fieldId = useId();
  const hintId = `${fieldId}-hint`;
  const errorId = `${fieldId}-error`;
  const descriptions = [hint ? hintId : '', error ? errorId : ''].filter(Boolean);
  return (
    <label className={`field ${className}`} {...props}>
      {label}
      {Children.map(children, (child) => fieldControl(child, error, descriptions))}
      {hint && (
        <span id={hintId} className="field-hint">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} className="form-error">
          {error}
        </span>
      )}
    </label>
  );
}

export function Modal({ title, description, onClose, children }) {
  const titleId = useId();
  const descriptionId = useId();
  const [previousFocus] = useState(() =>
    typeof document === 'undefined' ? null : document.activeElement,
  );
  useEffect(
    () => () => {
      if (typeof window === 'undefined' || previousFocus?.isConnected) return;
      window.requestAnimationFrame(() => {
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        const focused = document.activeElement;
        if (
          focused &&
          focused !== document.body &&
          focused !== document.documentElement &&
          focused.isConnected
        )
          return;
        document.getElementById('main')?.focus({ preventScroll: true });
      });
    },
    [previousFocus],
  );
  return (
    <Dialog
      open
      className="mycloset-dialog"
      maxWidth={false}
      scroll="paper"
      transitionDuration={0}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onClose={() => onClose?.()}
      slotProps={{
        paper: { id: 'modal', className: 'mycloset-dialog-paper' },
        backdrop: { className: 'mycloset-dialog-backdrop' },
      }}
    >
      <div className="modal-form">
        <div className="modal-header">
          <div>
            <p className="eyebrow">MYCLOSET</p>
            <h2 id={titleId}>{title}</h2>
            {description && (
              <p id={descriptionId} className="subtitle">
                {description}
              </p>
            )}
          </div>
          <AppButton type="button" className="icon-button" onClick={onClose} aria-label="Закрыть">
            <Icon name="close" />
          </AppButton>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </Dialog>
  );
}

export function ConfirmDialog({ title = 'Удалить?', description, onConfirm, onClose }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function confirm() {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await onConfirm();
      onClose();
    } catch (cause) {
      setError(cause.message || 'Не удалось выполнить действие.');
      setSaving(false);
    }
  }
  return (
    <Modal
      title={title}
      onClose={() => {
        if (!saving) onClose();
      }}
    >
      <p className="confirm-copy">{description}</p>
      {error && (
        <Alert
          className="form-error mui-form-alert"
          severity="error"
          variant="outlined"
          role="alert"
        >
          {error}
        </Alert>
      )}
      <div className="form-actions">
        <AppButton
          className="button button-secondary"
          onClick={onClose}
          disabled={saving}
          autoFocus
        >
          Отмена
        </AppButton>
        <AppButton className="button button-danger" onClick={confirm} disabled={saving}>
          {saving ? 'Сохраняем…' : 'Подтвердить'}
        </AppButton>
      </div>
    </Modal>
  );
}

export function ItemArt({ item = {} }) {
  if (item.photo) return <img src={item.photo} alt={item.name || 'Вещь'} loading="lazy" />;
  const color = COLORS[item.colors?.[0]]?.[1] || '#c8b3a0';
  const fill = color.startsWith('#') ? color : '#ba8b9f';
  const paths = {
    top: (
      <>
        <path d="m78 46 24-11q18 17 36 0l24 11 29 42-27 17-12-18v87H88V87l-12 18-27-17Z" />
        <path
          d="M102 35q1 27 18 27t18-27"
          fill="none"
          stroke="#fff"
          strokeOpacity=".5"
          strokeWidth="4"
        />
      </>
    ),
    bottom: (
      <>
        <path d="M82 37h76l9 139h-34l-13-91-13 91H73Z" />
        <path
          d="M84 56h72M120 39v42"
          fill="none"
          stroke="#fff"
          strokeOpacity=".5"
          strokeWidth="3"
        />
      </>
    ),
    dress: (
      <>
        <path d="m101 30 19 12 19-12 15 34-18 25 37 94H67l37-94-18-25Z" />
        <path d="M104 89h32" stroke="#fff" strokeOpacity=".5" strokeWidth="4" />
      </>
    ),
    outerwear: (
      <>
        <path d="m96 32 24 11 24-11 21 18 17 119-30 4-8-75v91H96V98l-8 75-30-4L75 50Z" />
        <path
          d="m96 32 24 41 24-41M120 73v116M93 110h54"
          fill="none"
          stroke="#fff"
          strokeOpacity=".5"
          strokeWidth="4"
        />
      </>
    ),
    shoes: (
      <>
        <path d="m48 104 39-32 25 23 35 14 38 8q18 3 18 20v15H42v-25q0-16 6-23Z" />
        <path
          d="M42 139h161M103 98l-11 18m28-13-11 18m28-13-11 18"
          fill="none"
          stroke="#fff"
          strokeOpacity=".65"
          strokeWidth="5"
        />
      </>
    ),
    accessory: (
      <>
        <rect x="66" y="79" width="108" height="93" rx="15" />
        <path
          d="M91 80V61a29 29 0 0 1 58 0v19"
          fill="none"
          stroke="currentColor"
          strokeWidth="10"
        />
        <rect x="107" y="106" width="26" height="18" rx="3" fill="#e7d4b0" />
      </>
    ),
  };
  return (
    <svg className="clothing-art" viewBox="0 0 240 220" aria-hidden="true" style={{ color: fill }}>
      <ellipse cx="120" cy="199" rx="70" ry="7" fill="#4b3b3c" opacity=".06" />
      <g fill="currentColor">{paths[item.category] || paths.top}</g>
    </svg>
  );
}

export function ColorDots({ colors = [] }) {
  return (
    <span className="color-dots">
      {colors.map(
        (color) =>
          COLORS[color] && (
            <span
              key={color}
              className="color-dot"
              style={{ background: COLORS[color][1] }}
              title={COLORS[color][0]}
            >
              <span className="sr-only">{COLORS[color][0]}</span>
            </span>
          ),
      )}
    </span>
  );
}

export function OutfitArt({ outfit, items = [] }) {
  const selected = (outfit?.itemIds || [])
    .map((id) => items.find((item) => item.id === id))
    .filter(Boolean);
  return (
    <div className="outfit-preview">
      {selected.slice(0, 4).map((item) => (
        <div className="outfit-piece" key={item.id}>
          <ItemArt item={item} />
        </div>
      ))}
      {(outfit?.missingItems || []).map((item) => (
        <div className="missing-piece" key={item.id}>
          <span className="missing-piece-icon">
            <Icon name="shopping" />
          </span>
          <span className="missing-piece-label">Нужно добавить</span>
          <strong>{item.name}</strong>
        </div>
      ))}
      {!selected.length && !outfit?.missingItems?.length && (
        <div className="empty-preview">
          <Icon name="outfits" size={44} />
        </div>
      )}
    </div>
  );
}
