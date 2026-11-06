// Push only. This worker does not intercept navigation, cache pages or provide offline mode.
self.addEventListener('install', (event) => event.waitUntil(self.skipWaiting()));
self.addEventListener('push', (event) => {
  let input;
  try { input = event.data?.json(); } catch { input = null; }
  const body = typeof input?.body === 'string' ? input.body.slice(0, 300) : 'Откройте MyCloset, чтобы посмотреть обновления.';
  let url = '/notifications';
  try {
    const target = new URL(input?.url || url, self.location.origin);
    if (target.origin === self.location.origin && ['/messages', '/calendar', '/notifications'].includes(target.pathname))
      url = target.pathname + target.search;
  } catch { /* Keep the safe own-origin inbox. */ }
  event.waitUntil(self.registration.showNotification('MyCloset', {
    body, tag: typeof input?.tag === 'string' ? input.tag.slice(0, 180) : 'mycloset-update',
    data: { url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = new URL(event.notification.data?.url || '/notifications', self.location.origin);
    if (target.origin !== self.location.origin) return;
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (existing) {
      await existing.navigate(target.href);
      await existing.focus();
    } else await self.clients.openWindow(target.href);
  })());
});
