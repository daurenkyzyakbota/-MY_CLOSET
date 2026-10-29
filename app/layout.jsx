import localFont from 'next/font/local';
import './globals.css';

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

export default function RootLayout({ children }) {
  return <html lang="ru" className={`${manrope.variable} ${cormorant.variable}`}><body>{children}</body></html>;
}
