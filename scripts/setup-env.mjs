import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import {
  buildEnvFile,
  cleanDatabaseUrl,
  neonAuthUrlFor,
  newCookieSecret,
  parseEnvFile,
} from './env-file.mjs';

// Creates or completes .env.local so accounts work on this computer.
// The database password is typed by the person and never stored in Git.
const file = new URL('../.env.local', import.meta.url);
const existingText = existsSync(file) ? readFileSync(file, 'utf8') : '';
const current = parseEnvFile(existingText);
const updates = {};
const ask = createInterface({ input: process.stdin, output: process.stdout });

try {
  let databaseUrl = current.DATABASE_URL;
  while (!databaseUrl) {
    console.log('\nОткройте https://console.neon.tech → проект MyCloset → ветка mycloset-app → Connect.');
    console.log('Скопируйте ссылку, которая начинается с postgresql://, и вставьте её сюда (правая кнопка мыши).');
    const answer = await ask.question('Ссылка на базу: ');
    try {
      databaseUrl = cleanDatabaseUrl(answer);
      updates.DATABASE_URL = databaseUrl;
    } catch (error) {
      console.log(`Не подходит: ${error.message} Попробуйте ещё раз.`);
    }
  }
  if (!current.NEON_AUTH_BASE_URL) {
    let authUrl = neonAuthUrlFor(databaseUrl);
    if (!authUrl) authUrl = (await ask.question('Адрес Neon Auth (Auth → Configuration): ')).trim();
    updates.NEON_AUTH_BASE_URL = authUrl;
  }
  if ((current.NEON_AUTH_COOKIE_SECRET?.length || 0) < 32) updates.NEON_AUTH_COOKIE_SECRET = newCookieSecret();
} finally {
  ask.close();
}

if (Object.keys(updates).length) {
  writeFileSync(file, buildEnvFile(existingText, updates));
  console.log('\nГотово: файл .env.local сохранён. Пароль в GitHub не попадает.');
} else {
  console.log('\nФайл .env.local уже настроен, ничего менять не нужно.');
}
console.log('Перезапустите сайт (Открыть MyCloset.cmd), и в «Мой аккаунт» появится вход.');
