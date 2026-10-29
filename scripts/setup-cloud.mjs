import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');
if (!process.env.DATABASE_URL) throw new Error('Сначала задайте DATABASE_URL в .env.local. Для локального гардероба база не нужна.');
const connection = new URL(process.env.DATABASE_URL);
connection.searchParams.delete('sslmode');
const database = new pg.Pool({ connectionString: connection.href, ssl: { rejectUnauthorized: true }, max: 1, connectionTimeoutMillis: 15000 });
try {
  for (const migration of ['../db/001-cloud-wardrobes.sql', '../db/002-lossless-json.sql']) await database.query(readFileSync(new URL(migration, import.meta.url), 'utf8'));
  console.log('Схема облачного гардероба готова. Секреты подключения не выводятся.');
} finally { await database.end(); }
