import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildEnvFile,
  cleanDatabaseUrl,
  neonAuthUrlFor,
  newCookieSecret,
  parseEnvFile,
} from '../scripts/env-file.mjs';

const url = 'postgresql://owner:pw@ep-dry-art-b931luwr-pooler.c-7.eu-central-1.aws.neon.tech/mycloset?sslmode=require';

test('derives the Neon Auth address from a pooled connection string', () => {
  assert.equal(
    neonAuthUrlFor(url),
    'https://ep-dry-art-b931luwr.neonauth.c-7.eu-central-1.aws.neon.tech/mycloset/auth',
  );
  assert.equal(neonAuthUrlFor('postgresql://u:p@localhost/db'), '');
});

test('accepts pasted connection strings with extra wrapping', () => {
  assert.equal(cleanDatabaseUrl(`  psql '${url}' `), url);
  assert.equal(cleanDatabaseUrl(`DATABASE_URL=${url}`), url);
  assert.throws(() => cleanDatabaseUrl('https://example.com'));
  assert.throws(() => cleanDatabaseUrl('postgresql://host/db'));
});

test('cookie secret is long enough for the server check', () => {
  assert.ok(newCookieSecret().length >= 32);
});

test('keeps existing lines and fills only missing values', () => {
  const before = '# local\nOPEN_METEO_API_KEY=k\nNEON_AUTH_COOKIE_SECRET=short\n';
  const after = buildEnvFile(before, { NEON_AUTH_COOKIE_SECRET: 'x'.repeat(64), DATABASE_URL: url });
  assert.deepEqual(parseEnvFile(after), {
    OPEN_METEO_API_KEY: 'k',
    NEON_AUTH_COOKIE_SECRET: 'x'.repeat(64),
    DATABASE_URL: url,
  });
  assert.ok(after.startsWith('# local\n'));
});
