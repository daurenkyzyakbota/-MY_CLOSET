import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { packageNotificationCron, singleEntryZip } from '../../../scripts/package-notification-cron.mjs';

test('package contains one self-contained entry and is byte-identical across output directories', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'mycloset-cron-'));
  try {
    const first = await packageNotificationCron(join(directory, 'work', 'first'));
    const second = await packageNotificationCron(join(directory, 'work', 'second'));
    const zip = await readFile(first.zipPath);
    assert.deepEqual(zip, await readFile(second.zipPath));
    assert.deepEqual(Buffer.from(await readFile(first.base64Path, 'utf8'), 'base64'), zip);
    const end = zip.length - 22;
    assert.equal(zip.readUInt32LE(end), 0x06054b50);
    assert.equal(zip.readUInt16LE(end + 10), 1);
    assert.equal(zip.readUInt32LE(0), 0x04034b50);
    assert.equal(zip.readUInt16LE(8), 0);
    const nameLength = zip.readUInt16LE(26);
    assert.equal(zip.subarray(30, 30 + nameLength).toString(), 'index.mjs');
    const size = zip.readUInt32LE(22);
    const source = zip.subarray(30 + nameLength, 30 + nameLength + size);
    assert.deepEqual(source, await readFile(join(directory, 'work', 'first', 'index.mjs')));
    assert.match(source.toString(), /Apache License/);
    assert.doesNotMatch(source.toString(), /from ["']@neon\/functions|sourceMappingURL|Bearer fixture/);
    const bundled = await import(pathToFileURL(join(directory, 'work', 'first', 'index.mjs')).href);
    assert.equal(typeof bundled.default.fetch, 'function');
    assert.equal((await bundled.default.fetch(new Request('https://function.example/cron', { method: 'POST' }))).status, 401);
    assert.equal(first.functionSlug, 'notificationscron');
    assert.equal(first.runtime, 'nodejs24');
  } finally {
    // Never recursively remove a computed directory outside this test's temp root.
    assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
    assert.match(basename(directory), /^mycloset-cron-/);
    await rm(directory, { recursive: true, force: true });
  }
});

test('ZIP helper rejects arbitrary entry names and packaging stays under work', async () => {
  assert.throws(() => singleEntryZip(Buffer.from('one'), '.env'), /index.mjs/);
  await assert.rejects(packageNotificationCron(join(tmpdir(), 'outside-package-directory')), /work directory/);
});
