import { randomBytes } from 'node:crypto';

// Pure helpers for scripts/setup-env.mjs, kept separate so they can be tested.

export function parseEnvFile(text = '') {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([A-Z0-9_]+)\s*=(.*)$/.exec(line);
    if (match) values[match[1]] = match[2].trim();
  }
  return values;
}

export function cleanDatabaseUrl(input = '') {
  let value = String(input).trim();
  value = value.replace(/^DATABASE_URL\s*=\s*/, '');
  value = value.replace(/^psql\s+/, '');
  value = value.replace(/^['"]|['"]$/g, '');
  const url = new URL(value);
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Error('Нужна ссылка, которая начинается с postgresql://');
  if (!url.username || !url.password) throw new Error('В ссылке нет имени пользователя или пароля.');
  if (url.pathname.length < 2) throw new Error('В ссылке нет имени базы данных.');
  return url.href;
}

// Managed Neon Auth lives next to the compute endpoint:
// ep-name[-pooler].region.aws.neon.tech/db -> https://ep-name.neonauth.region.aws.neon.tech/db/auth
export function neonAuthUrlFor(databaseUrl) {
  const url = new URL(databaseUrl);
  if (!url.hostname.endsWith('.neon.tech')) return '';
  const [endpoint, ...rest] = url.hostname.split('.');
  const database = decodeURIComponent(url.pathname.slice(1));
  return `https://${endpoint.replace(/-pooler$/, '')}.neonauth.${rest.join('.')}/${database}/auth`;
}

export function newCookieSecret() {
  return randomBytes(32).toString('hex');
}

export function buildEnvFile(existingText, updates) {
  const lines = existingText ? existingText.split(/\r?\n/) : [];
  const pending = { ...updates };
  const result = lines.map((line) => {
    const match = /^\s*([A-Z0-9_]+)\s*=/.exec(line);
    if (match && match[1] in pending) {
      const next = `${match[1]}=${pending[match[1]]}`;
      delete pending[match[1]];
      return next;
    }
    return line;
  });
  while (result.length && result.at(-1) === '') result.pop();
  for (const [key, value] of Object.entries(pending)) result.push(`${key}=${value}`);
  return `${result.join('\n')}\n`;
}
