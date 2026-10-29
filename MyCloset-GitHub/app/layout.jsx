import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import { ThemeRegistry } from './theme-registry.jsx';

export const metadata = {
  title: 'MyCloset — ваш личный гардероб',
  description: 'Добавляйте вещи, собирайте образы и планируйте, что надеть.',
  manifest: '/manifest.webmanifest',
  icons: {
    icon: '/assets/app-icon.svg',
    apple: '/assets/app-icon-192.png'
  },
  appleWebApp: {
    capable: true,
    title: 'MyCloset',
    statusBarStyle: 'default'
  }
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#352333'
};

export default function RootLayout({ children }) {
  return (
    <html lang="ru">
      <head>
        <meta name="mycloset-app" content="4" />
        <link rel="preload" href="/assets/fonts/manrope.ttf" as="font" type="font/ttf" crossOrigin="anonymous" />
        <link rel="stylesheet" href="/bootstrap.min.css" />
        <link rel="stylesheet" href="/styles.css" />
      </head>
      <body>
        <AppRouterCacheProvider>
          <ThemeRegistry>{children}</ThemeRegistry>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}