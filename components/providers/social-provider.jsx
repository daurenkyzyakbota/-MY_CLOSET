'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useCloudSync } from '@/components/providers/cloud-sync-provider.jsx';
import { socialRequest } from '@/lib/social/client.js';

const SocialContext = createContext(null);
const emptyCounts = { messages: 0, notifications: 0, requests: 0 };

export function SocialProvider({ children }) {
  const cloud = useCloudSync();
  const userId = cloud.user?.id || '';
  const current = useRef(userId);
  current.current = userId;
  const sequence = useRef(0);
  const [view, setView] = useState({
    owner: '',
    profile: null,
    counts: emptyCounts,
    ready: false,
    error: '',
  });
  const request = useCallback(async (action, input = {}, options = {}) => {
    const owner = current.current;
    if (options.expectedUserId !== undefined && options.expectedUserId !== owner)
      throw new DOMException('Аккаунт изменился.', 'AbortError');
    const result = await socialRequest(action, input, { ...options, userId: owner });
    if (owner !== current.current) throw new DOMException('Аккаунт изменился.', 'AbortError');
    return result;
  }, []);
  const refresh = useCallback(
    async ({ signal, quiet = false } = {}) => {
      const owner = current.current;
      if (!owner) return;
      const token = ++sequence.current;
      try {
        const result = await request('bootstrap', {}, { signal });
        if (token === sequence.current && owner === current.current) {
          setView({
            owner,
            profile: result.profile,
            counts: result.counts,
            ready: true,
            error: '',
          });
        }
        return result;
      } catch (cause) {
        if (
          cause.name !== 'AbortError' &&
          token === sequence.current &&
          owner === current.current
        ) {
          setView((value) => ({ ...value, owner, ready: true, error: cause.message }));
          if (!quiet) throw cause;
        }
      }
    },
    [request],
  );
  useEffect(() => {
    const controller = new AbortController();
    sequence.current++;
    setView({ owner: userId, profile: null, counts: emptyCounts, ready: !userId, error: '' });
    if (userId && cloud.configured && !cloud.requiresHttps)
      void refresh({ signal: controller.signal, quiet: true });
    return () => controller.abort();
  }, [userId, cloud.configured, cloud.requiresHttps, refresh]);
  useEffect(() => {
    if (!userId || !cloud.configured || cloud.requiresHttps) return;
    let active;
    const poll = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine || active) return;
      active = new AbortController();
      void refresh({ signal: active.signal, quiet: true }).finally(() => {
        active = null;
      });
    };
    const timer = setInterval(poll, 15000);
    document.addEventListener('visibilitychange', poll);
    window.addEventListener('online', poll);
    return () => {
      clearInterval(timer);
      active?.abort();
      document.removeEventListener('visibilitychange', poll);
      window.removeEventListener('online', poll);
    };
  }, [userId, cloud.configured, cloud.requiresHttps, refresh]);
  const visible =
    view.owner === userId
      ? view
      : { profile: null, counts: emptyCounts, ready: !userId, error: '' };
  const updateProfile = useCallback(
    (profile) =>
      setView((value) => ({ ...value, owner: current.current, profile, ready: true, error: '' })),
    [],
  );
  return (
    <SocialContext.Provider
      value={{
        user: cloud.user,
        profile: visible.profile,
        counts: visible.counts,
        ready: !cloud.sessionLoading && visible.ready,
        configured: cloud.configured,
        requiresHttps: cloud.requiresHttps,
        error: visible.error || cloud.authError || cloud.configError,
        refresh,
        request,
        updateProfile,
      }}
    >
      {children}
    </SocialContext.Provider>
  );
}

export function useSocial() {
  const value = useContext(SocialContext);
  if (!value) throw new Error('useSocial должен использоваться внутри SocialProvider.');
  return value;
}
