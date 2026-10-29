'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { readListPreferences, writeListPreferences } from '../lib/list-preferences.js';

function tabStorage() {
  try { return window.sessionStorage; } catch { return null; }
}

/** Restore only after domain data is ready, so free-text style options are known. */
export function useListPreferences({ storageKey, enabled, defaults, sanitize, readOverrides }) {
  const latest = useRef({ sanitize, readOverrides });
  latest.current = { sanitize, readOverrides };
  const [snapshot, setSnapshot] = useState({ key: null, value: defaults });
  const restored = enabled && snapshot.key === storageKey;
  const preferences = sanitize(restored ? snapshot.value : defaults);
  const serialized = JSON.stringify(preferences);

  useEffect(() => {
    if (!enabled) return;
    const { sanitize: normalize, readOverrides: overrides } = latest.current;
    const value = readListPreferences(tabStorage(), storageKey, normalize, overrides?.() || {});
    setSnapshot({ key: storageKey, value });
  }, [storageKey, enabled]);

  useEffect(() => {
    if (!restored) return;
    writeListPreferences(tabStorage(), storageKey, JSON.parse(serialized));
    // Also forget stale free-text styles in memory if a garment was removed.
    setSnapshot(current => {
      if (current.key !== storageKey) return current;
      const value = latest.current.sanitize(current.value);
      return JSON.stringify(current.value) === JSON.stringify(value) ? current : { key: storageKey, value };
    });
  }, [storageKey, restored, serialized]);

  const setPreferences = useCallback(update => {
    setSnapshot(current => {
      const normalize = latest.current.sanitize;
      const previous = normalize(current.key === storageKey ? current.value : defaults);
      return { key: storageKey, value: normalize(typeof update === 'function' ? update(previous) : update) };
    });
  }, [storageKey, defaults]);

  return [preferences, setPreferences, restored];
}
