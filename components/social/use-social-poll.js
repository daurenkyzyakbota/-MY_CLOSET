'use client';

import { useEffect, useRef, useState } from 'react';

/** Poll only while the person can see the page; abort work when it is left. */
export function useSocialPoll(callback, enabled = true, interval = 8000) {
  const latest = useRef(callback);
  latest.current = callback;

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let running = false;
    async function update() {
      if (running || document.visibilityState !== 'visible' || !navigator.onLine) return;
      running = true;
      try {
        await latest.current(controller.signal);
      } catch {
        // Each caller renders its own error and retry action.
      } finally {
        running = false;
      }
    }
    const timer = window.setInterval(update, interval);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('online', update);
    window.addEventListener('focus', update);
    void update();
    return () => {
      controller.abort();
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('online', update);
      window.removeEventListener('focus', update);
    };
  }, [enabled, interval]);
}

export function useNarrowSocialScreen() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 760px)');
    const update = () => setNarrow(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return narrow;
}
