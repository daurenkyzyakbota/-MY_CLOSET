import { cpSync, existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const option = (name) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const source = path.resolve(option('--source') || fileURLToPath(new URL('..', import.meta.url)));
const target = path.resolve(option('--target') || path.join(source, '.local', 'hosting-source'));
if (target === source || !existsSync(target) || !existsSync(path.join(target, 'scripts/execution-profile.mjs')))
  throw new Error('First prepare or open the matching Sites checkout, then pass its directory with --target.');
if (realpathSync(target).toLowerCase() !== target.toLowerCase())
  throw new Error('Hosting workspace must not be a symbolic link.');
const identity = JSON.parse(readFileSync(path.join(source, '.openai/hosting.json'), 'utf8'));
const targetIdentity = JSON.parse(readFileSync(path.join(target, '.openai/hosting.json'), 'utf8'));
if (targetIdentity.project_id && identity.project_id !== targetIdentity.project_id)
  throw new Error('The destination belongs to a different Site.');

for (const directory of ['app', 'components', 'public', 'db']) {
  const destination = path.resolve(target, directory);
  if (!destination.startsWith(`${path.resolve(target)}${path.sep}`)) throw new Error('Unsafe copy target.');
  rmSync(destination, { recursive: true, force: true });
  cpSync(path.join(source, directory), destination, { recursive: true });
}
cpSync(path.join(source, 'lib'), path.join(target, 'lib'), { recursive: true });
cpSync(path.join(source, 'tests'), path.join(target, 'tests'), { recursive: true });

const file = (name, contents) => {
  const destination = path.join(target, name);
  mkdirSync(path.dirname(destination), { recursive: true });
  writeFileSync(destination, contents, 'utf8');
};

// Workerd supplies browser conditions, while the S3 entry point selects its Node
// runtime config. Resolve the SDK consistently on the server; mixing it with
// browser-only Smithy sentinels breaks S3Client before any request is sent.
file('scripts/vite/mycloset-aws-node.mjs', `import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export function myclosetAwsNode() {
  return {
    name: 'mycloset-aws-node',
    enforce: 'pre',
    resolveId(id) {
      if (['rsc', 'ssr'].includes(this.environment.name) && /^@(aws-sdk|smithy)\\//.test(id))
        return require.resolve(id);
    },
  };
}
`);
let viteConfig = readFileSync(path.join(target, 'vite.config.ts'), 'utf8');
if (!viteConfig.includes('myclosetAwsNode')) {
  if (!viteConfig.includes('plugins: [')) throw new Error('Hosting Vite plugin structure changed.');
  viteConfig = `import { myclosetAwsNode } from './scripts/vite/mycloset-aws-node.mjs';\n${viteConfig}`
    .replace('plugins: [', 'plugins: [\n      myclosetAwsNode(),');
  file('vite.config.ts', viteConfig);
}

if (process.argv.includes('--dependencies')) {
  const app = JSON.parse(readFileSync(path.join(source, 'package.json'), 'utf8'));
  const hosted = JSON.parse(readFileSync(path.join(target, 'package.json'), 'utf8'));
  for (const [name, version] of Object.entries(app.dependencies)) {
    if (!['react', 'react-dom'].includes(name)) hosted.dependencies[name] = version;
  }
  hosted.dependencies['@neondatabase/serverless'] = '^1.0.2';
  hosted.overrides = { ...hosted.overrides, ...app.overrides };
  // npm requires a direct dependency to match its global override. The Sites
  // starter includes zod directly; keep the hosted copy on the audited version.
  if (typeof app.overrides?.zod === 'string' && Object.hasOwn(hosted.dependencies, 'zod'))
    hosted.dependencies.zod = app.overrides.zod;
  hosted.name = 'mycloset-hosted';
  hosted.scripts.test = app.scripts.test;
  file('package.json', `${JSON.stringify(hosted, null, 2)}\n`);
}

// Keep the ordinary Node/Next checkout unchanged. Hosting uses request-scoped
// WebSocket Postgres connections, supported by the Workers runtime.
const databaseFile = path.join(target, 'lib/cloud/cloud-database.js');
let databaseCode = readFileSync(databaseFile, 'utf8');
const metadataStart = databaseCode.indexOf('const metadata =');
if (metadataStart < 0) throw new Error('Database adapter structure changed.');
databaseCode = `import { hostedDatabase } from './hosted-context.js';\n\nexport function database() {\n  return hostedDatabase();\n}\n\n${databaseCode.slice(metadataStart)}`;
file('lib/cloud/cloud-database.js', databaseCode);
// The Worker bounds one wardrobe JSON document; separate private photo objects
// have their own quota. Legacy oversized inline copies remain intact in Postgres,
// and local backups retain the original, larger format limit.
const cloudHandlersFile = path.join(target, 'lib/cloud/cloud-handlers.js');
file('lib/cloud/cloud-handlers.js', readFileSync(cloudHandlersFile, 'utf8').replace(
  'const limit = MAX_BACKUP_FILE_BYTES + 4096;',
  'const limit = Math.min(MAX_BACKUP_FILE_BYTES, 12 * 1024 * 1024) + 4096;',
).replace(
  "report(error.code || 'CLOUD_ERROR');",
  `if (error.code === 'CLOUD_COPY_TOO_LARGE')
          return reply({ error: 'Данные гардероба для загрузки больше 12 МиБ. Копия сохранена в базе; откройте локальную версию или резервную копию. Фотографии из отдельного хранилища в этот лимит не входят.', code: error.code }, 413);
        report(error.code || 'CLOUD_ERROR');`,
));
databaseCode = readFileSync(databaseFile, 'utf8').replace(
  'SELECT revision,snapshot_hash,wire_hash,updated_at FROM public.mycloset_wardrobes',
  'SELECT revision,snapshot_hash,wire_hash,updated_at,octet_length(snapshot::text) AS snapshot_bytes FROM public.mycloset_wardrobes',
).replace(
  'if (!rows.length) return { ...metadata(null), snapshot: null };',
  `if (!rows.length) return { ...metadata(null), snapshot: null };
    if (Number(rows[0].snapshot_bytes) > 12 * 1024 * 1024)
      throw Object.assign(new Error('Cloud copy exceeds the hosted request limit; the stored copy is unchanged.'), { code: 'CLOUD_COPY_TOO_LARGE' });`,
);
file('lib/cloud/cloud-database.js', databaseCode);
file('lib/cloud/hosted-context.js', `import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool } from '@neondatabase/serverless';

const requests = new AsyncLocalStorage();
export function hostedDatabase() {
  const context = requests.getStore();
  if (!context) throw new Error('Database request context is unavailable.');
  return context.pool ||= new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 3,
    connectionTimeoutMillis: 15000,
    query_timeout: 25000,
  });
}
export async function withHostedDatabase(work, execution) {
  const context = { pool: null };
  try {
    return await requests.run(context, work);
  } finally {
    if (context.pool) execution.waitUntil(context.pool.end());
  }
}
`);

// DNS-over-HTTPS replaces native UDP DNS only in the hosted bundle.
const validationFile = path.join(target, 'lib/cloud/email-validation.js');
file('lib/cloud/email-validation.js', readFileSync(validationFile, 'utf8').replace(
  "import { Resolver } from 'node:dns/promises';",
  "import { Resolver } from './hosted-dns.js';",
));
file('lib/cloud/hosted-dns.js', `const failure = (code) => Object.assign(new Error('DNS lookup failed'), { code });
export class Resolver {
  constructor() { this.controller = new AbortController(); }
  cancel() { this.controller.abort(); }
  async query(domain, type) {
    const url = new URL('https://cloudflare-dns.com/dns-query');
    url.searchParams.set('name', domain);
    url.searchParams.set('type', String(type));
    const response = await fetch(url, {
      headers: { Accept: 'application/dns-json' },
      signal: this.controller.signal,
    });
    if (!response.ok) throw failure('ESERVFAIL');
    const result = await response.json();
    if (result.Status === 3) throw failure('ENOTFOUND');
    if (result.Status !== 0) throw failure('ESERVFAIL');
    const answers = (result.Answer || []).filter((answer) => answer.type === type);
    if (!answers.length) throw failure('ENODATA');
    return answers;
  }
  async resolveMx(domain) {
    return (await this.query(domain, 15)).map(({ data }) => {
      const match = /^(\\d+)\\s+(.+)$/.exec(data);
      if (!match) throw failure('ESERVFAIL');
      return { priority: Number(match[1]), exchange: match[2] === '.' ? '.' : match[2].replace(/\\.$/, '') };
    });
  }
  async resolve4(domain) { return (await this.query(domain, 1)).map(({ data }) => data); }
  async resolve6(domain) { return (await this.query(domain, 28)).map(({ data }) => data); }
}
`);

file('app/api/device/route.js', `import { buildDeviceLinks } from '../../../lib/devices/device-links.js';
export const dynamic = 'force-dynamic';
export function GET(request) {
  return Response.json(buildDeviceLinks(request, {}), { headers: { 'Cache-Control': 'no-store' } });
}
`);
file('worker/index.ts', `import handler from 'vinext/server/fetch-handler';
import { withHostedDatabase } from '../lib/cloud/hosted-context.js';
export default {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    return withHostedDatabase(() => handler.fetch(request, env, ctx), ctx);
  },
};
`);
console.log('Hosting source prepared without copying credentials or browser data.');
