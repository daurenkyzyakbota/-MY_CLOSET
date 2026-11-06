import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const sourceDirectory = fileURLToPath(new URL('../functions/notifications-cron/', import.meta.url));

/** One stored ZIP entry, fixed DOS timestamp, no paths, metadata or env files. */
export function singleEntryZip(contents, name = 'index.mjs') {
  if (name !== 'index.mjs' || !Buffer.isBuffer(contents)) throw new Error('Expected the bundled index.mjs.');
  let checksum = 0xffffffff;
  for (const byte of contents) {
    checksum ^= byte;
    for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
  }
  checksum = (checksum ^ 0xffffffff) >>> 0;
  const filename = Buffer.from(name, 'utf8');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0x0021, 12); // 1980-01-01, deterministic across machines.
  local.writeUInt32LE(checksum, 14);
  local.writeUInt32LE(contents.length, 18);
  local.writeUInt32LE(contents.length, 22);
  local.writeUInt16LE(filename.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0x0021, 14);
  central.writeUInt32LE(checksum, 16);
  central.writeUInt32LE(contents.length, 20);
  central.writeUInt32LE(contents.length, 24);
  central.writeUInt16LE(filename.length, 28);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(central.length + filename.length, 12);
  end.writeUInt32LE(local.length + filename.length + contents.length, 16);
  return Buffer.concat([local, filename, contents, central, filename, end]);
}

export async function packageNotificationCron(outdir) {
  if (Number(process.versions.node.split('.')[0]) !== 24) throw new Error('Use Node.js 24 for Neon Functions.');
  if (typeof outdir !== 'string' || !outdir) throw new Error('Pass --outdir <work/package-directory>.');
  const destination = resolve(outdir);
  if (!destination.split(sep).some((part) => part.toLowerCase() === 'work')) throw new Error('Write the package under a work directory.');
  const require = createRequire(new URL('../functions/notifications-cron/package.json', import.meta.url));
  let build;
  try { ({ build } = require('esbuild')); }
  catch { throw new Error('Run npm ci --ignore-scripts in functions/notifications-cron first.'); }
  await mkdir(destination, { recursive: true });
  const sdkLicense = await readFile(resolve(sourceDirectory, 'node_modules/@neon/functions/LICENSE'), 'utf8');
  const output = resolve(destination, 'index.mjs');
  await build({
    absWorkingDir: sourceDirectory,
    entryPoints: ['index.js'], outfile: output,
    platform: 'node', target: 'node24', format: 'esm', bundle: true,
    sourcemap: false, legalComments: 'eof', logLevel: 'silent',
    banner: { js: `/*! Bundled @neon/functions 0.11.0 — Apache-2.0\n${sdkLicense.replaceAll('*/', '* /')}\n*/` },
  });
  const contents = await readFile(output);
  const zip = singleEntryZip(contents);
  const zipPath = resolve(destination, 'notificationscron.zip');
  const base64Path = `${zipPath}.base64`;
  await writeFile(zipPath, zip);
  await writeFile(base64Path, zip.toString('base64'), 'utf8');
  const metadata = {
    functionSlug: 'notificationscron', runtime: 'nodejs24', entrypoint: 'index.mjs',
    zipBytes: zip.length, sha256: createHash('sha256').update(zip).digest('hex'),
  };
  await writeFile(resolve(destination, 'manifest.json'), `${JSON.stringify(metadata, null, 2)}\n`, 'utf8');
  return { ...metadata, zipPath, base64Path };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--outdir') throw new Error('Usage: node scripts/package-notification-cron.mjs --outdir <work/package-directory>');
  const result = await packageNotificationCron(args[1]);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
