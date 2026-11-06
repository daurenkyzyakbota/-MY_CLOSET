import { createNeonAuth } from '@neondatabase/auth/next/server';
import { database } from './cloud-database.js';

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
export async function currentCloudUser({ fresh = false } = {}) {
  // The official SDK verifies its signed cookie. Check the referenced managed
  // session in Postgres as well, so revocation is immediate without one upstream
  // Auth HTTP call for every avatar, outfit thumbnail and polling request.
  const result = await getAuthServer().getSession();
  if (result.error) {
    const error = new Error('Не удалось проверить вход в аккаунт.');
    error.code = result.error.code || 'SESSION_UNAVAILABLE';
    console.error('MyCloset session:', error.code, result.error.status);
    throw error;
  }
  const user = result.data?.user;
  const session = result.data?.session;
  if (!user?.id || !session?.id) return null;
  if (fresh) {
    const { rows } = await database().query(
      'SELECT EXISTS(SELECT 1 FROM neon_auth.session s JOIN neon_auth."user" u ON u.id=s."userId" WHERE s.id=$1::uuid AND u.id=$2::uuid AND s."expiresAt">now()) AS valid',
      [session.id, user.id],
    );
    if (!rows[0]?.valid) return null;
  }
  return user;
}
