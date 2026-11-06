'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import OutlinedInput from '@mui/material/OutlinedInput';
import { useCloset } from '@/components/providers/closet-provider.jsx';
import { searchCloset } from '@/lib/data/quick-search.js';
import { AppButton } from '@/components/ui/app-button.jsx';
import { Icon, Modal } from '@/components/ui/ui.jsx';

export default function QuickSearch({ onClose }) {
  const { state } = useCloset();
  const router = useRouter();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('all');
  const [active, setActive] = useState(0);
  const results = useMemo(
    () => searchCloset(state, query, { kind, limit: 12 }),
    [state, query, kind],
  );
  const index = Math.min(active, Math.max(0, results.length - 1));
  useEffect(() => {
    document.getElementById(`${listId}-${index}`)?.scrollIntoView({ block: 'nearest' });
  }, [listId, index, query, kind]);
  function open(row) {
    if (!row) return;
    onClose();
    router.push(row.href);
  }
  function keyboard(event) {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((value) =>
        results.length
          ? (value + (event.key === 'ArrowDown' ? 1 : results.length - 1)) % results.length
          : 0,
      );
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      open(results[index]);
    }
  }
  return (
    <Modal
      title="Найти в MyCloset"
      description="Ваши вещи, образы, покупки и разделы сайта."
      onClose={onClose}
    >
      <div className="quick-search">
        <OutlinedInput
          fullWidth
          autoFocus
          type="search"
          value={query}
          placeholder="Название, бренд или раздел…"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={keyboard}
          inputProps={{
            maxLength: 120,
            role: 'combobox',
            'aria-label': 'Поиск по гардеробу и разделам',
            'aria-autocomplete': 'list',
            'aria-controls': listId,
            'aria-expanded': true,
            'aria-activedescendant': results.length ? `${listId}-${index}` : undefined,
          }}
        />
        <div className="quick-search-kinds" role="group" aria-label="Где искать">
          {[
            ['all', 'Всё'],
            ['item', 'Вещи'],
            ['outfit', 'Образы'],
            ['shopping', 'Покупки'],
          ].map(([value, label]) => (
            <AppButton
              key={value}
              className="btn btn-ghost"
              aria-pressed={kind === value}
              onClick={() => {
                setKind(value);
                setActive(0);
              }}
            >
              {label}
            </AppButton>
          ))}
        </div>
        <div
          id={listId}
          role="listbox"
          aria-label="Результаты поиска"
          className="quick-search-results"
        >
          {results.map((row, position) => (
            <AppButton
              key={row.id}
              id={`${listId}-${position}`}
              role="option"
              aria-selected={position === index}
              tabIndex={-1}
              className={`quick-search-result${position === index ? ' is-active' : ''}`}
              onMouseEnter={() => setActive(position)}
              onClick={() => open(row)}
            >
              <span className="quick-search-symbol">
                <Icon name={row.icon} />
              </span>
              <span>
                <strong>{row.title}</strong>
                <small>{row.subtitle}</small>
              </span>
              <Icon name="arrow-right" />
            </AppButton>
          ))}
        </div>
        {!results.length && (
          <p className="quick-search-empty" role="status">
            Ничего не найдено. Попробуйте другое название или бренд.
          </p>
        )}
        <p className="footnote">↑ ↓ — выбрать, Enter — открыть, Esc — закрыть.</p>
      </div>
    </Modal>
  );
}
