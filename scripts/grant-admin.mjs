// Назначает первого администратора MyCloset по почте аккаунта.
// Использование: npm run admin:grant -- почта@пример.kz
// Снять роль:    npm run admin:grant -- почта@пример.kz --revoke
import { existsSync } from 'node:fs';
import pg from 'pg';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const args = process.argv.slice(2);
const revoke = args.includes('--revoke');
const email = args.find((value) => !value.startsWith('--'))?.trim().toLowerCase();
if (!email || !email.includes('@') || email.length > 254) {
  console.error('Укажите почту аккаунта: npm run admin:grant -- почта@пример.kz');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('Сначала задайте DATABASE_URL в .env.local.');
  process.exit(1);
}
const connection = new URL(process.env.DATABASE_URL);
connection.searchParams.delete('sslmode');
const database = new pg.Pool({
  connectionString: connection.href,
  ssl: { rejectUnauthorized: true },
  max: 1,
  connectionTimeoutMillis: 15000,
});
try {
  const { rows } = await database.query(
    `UPDATE public.mycloset_profiles p SET role=$2, banned_at=CASE WHEN $2='admin' THEN NULL ELSE p.banned_at END
    FROM neon_auth."user" u WHERE lower(u.email)=$1 AND p.user_id=u.id::text RETURNING p.username`,
    [email, revoke ? 'user' : 'admin'],
  );
  if (!rows.length) {
    console.error(
      'Профиль с такой почтой не найден. Войдите на сайт с этой почтой и создайте профиль в «Сообществе», затем повторите.',
    );
    process.exitCode = 1;
  } else
    console.log(
      revoke
        ? `Роль администратора снята с @${rows[0].username}.`
        : `@${rows[0].username} теперь администратор. Обновите страницу сайта: в меню появится «Админ-панель».`,
    );
} finally {
  await database.end();
}
