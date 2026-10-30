import { createNeonAuth } from '@neondatabase/auth/next/server';

let instance;
export function cloudConfigured() {
  return (
    !!process.env.DATABASE_URL &&
    !!process.env.NEON_AUTH_BASE_URL &&
    (process.env.NEON_AUTH_COOKIE_SECRET?.length || 0) >= 32
  );
}
export function getAuthServer() {
  if (!cloudConfigured()) throw new Error('Облачное подключение ещё не настроено.');
  return (instance ||= createNeonAuth({
    baseUrl: process.env.NEON_AUTH_BASE_URL,
    cookies: { secret: process.env.NEON_AUTH_COOKIE_SECRET, sessionDataTtl: 60 },
    logLevel: 'warn',
  }));
}
export async function currentCloudUser() {
  const result = await getAuthServer().getSession();
  return result.data?.user || null;
}
