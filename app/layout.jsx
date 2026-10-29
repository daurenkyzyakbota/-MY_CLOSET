import localFont from 'next/font/local';
import { AppRouterCacheProvider } from '@mui/material-nextjs/v16-appRouter';
import InitColorSchemeScript from '@mui/material/InitColorSchemeScript';
import UiThemeProvider from '@/components/ui-theme-provider.jsx';
import 'bootstrap/dist/css/bootstrap-grid.min.css';
import 'bootstrap/dist/css/bootstrap-utilities.min.css';
import './globals.css';
import './bootstrap-layout.css';
import './ui-libraries.css';
import './device-access.css';
import './themes.css';
import './collections.css';
import './media-tools.css';
import './wardrobe-life.css';
import './account.css';

const manrope = localFont({ src: '../public/assets/fonts/manrope.ttf', variable: '--font-ui', display: 'swap', weight: '200 800' });
const cormorant = localFont({ src: [{ path: '../public/assets/fonts/cormorant-garamond.ttf', weight: '300 700', style: 'normal' }, { path: '../public/assets/fonts/cormorant-garamond-italic.ttf', weight: '300 700', style: 'italic' }], variable: '--font-display', display: 'swap' });

export const metadata = {
  title: { default: 'MyCloset — ваш личный гардероб', template: '%s · MyCloset' },
  description: 'Бережно собирайте свой гардероб, создавайте образы и планируйте стильные дни.',
  icons: { icon: '/assets/app-icon.svg', apple: '/assets/app-icon-192.png' },
  applicationName: 'MyCloset',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'MyCloset', statusBarStyle: 'default' },
};
export const viewport = { width: 'device-width', initialScale: 1, themeColor: '#352333' };

// MUI's initializer can stop before applying the system preference when storage is blocked.
const themeFallbackScript = `(function(){var root=document.documentElement;if(!root.hasAttribute('data-theme')){var mode='light';try{if(window.matchMedia('(prefers-color-scheme: dark)').matches)mode='dark';}catch(_){}root.setAttribute('data-theme',mode);}})();`;

export default function RootLayout({ children }) {
  return <html lang="ru" className={`${manrope.variable} ${cormorant.variable}`} suppressHydrationWarning><body><InitColorSchemeScript attribute="[data-theme='%s']" defaultMode="system" modeStorageKey="mycloset-theme-mode" colorSchemeStorageKey="mycloset-theme-scheme"/><script id="mycloset-theme-fallback" dangerouslySetInnerHTML={{ __html: themeFallbackScript }}/><AppRouterCacheProvider options={{ key: 'mycloset', enableCssLayer: true }}><UiThemeProvider>{children}</UiThemeProvider></AppRouterCacheProvider></body></html>;
}
