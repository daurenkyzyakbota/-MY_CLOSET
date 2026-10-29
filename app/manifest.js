export default function manifest() {
  return {
    name: 'MyCloset — ваш личный гардероб',
    short_name: 'MyCloset',
    description: 'Любимые вещи, новые сочетания и планы на каждый день.',
    lang: 'ru',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#fcfaf7',
    theme_color: '#352333',
    icons: [
      { src: '/assets/app-icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/assets/app-icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  };
}
