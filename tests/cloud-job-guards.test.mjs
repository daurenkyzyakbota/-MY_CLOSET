import test from 'node:test';
import assert from 'node:assert/strict';
import { refreshCurrentConflict, switchOwnerAfterSync } from '../lib/cloud/cloud-job-guards.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('a slow previous sync cannot switch the wardrobe back after another account already opened', async () => {
  const previousSync = deferred();
  const opened = [];
  let owner = 'account-a';
  let firstEffectActive = true;
  const stale = switchOwnerAfterSync(previousSync.promise, 'account-a', {
    isCurrent: () => firstEffectActive && owner === 'account-a',
    switchOwner: async (id) => opened.push(id),
  });
  firstEffectActive = false;
  owner = 'account-b';
  assert.equal(await switchOwnerAfterSync(null, 'account-b', {
    isCurrent: () => owner === 'account-b',
    switchOwner: async (id) => opened.push(id),
  }), true);
  previousSync.resolve();
  assert.equal(await stale, false);
  assert.deepEqual(opened, ['account-b']);
});

test('an aborted old sync still permits the current switch, while unmount cancels it', async () => {
  const aborted = deferred();
  const opened = [];
  const current = switchOwnerAfterSync(aborted.promise, '', {
    isCurrent: () => true,
    switchOwner: async (id) => opened.push(id),
  });
  aborted.reject(new DOMException('Account left', 'AbortError'));
  assert.equal(await current, true);
  assert.deepEqual(opened, ['']);
  assert.equal(await switchOwnerAfterSync(null, 'account-a', {
    isCurrent: () => false,
    switchOwner: async (id) => opened.push(id),
  }), false);
  assert.deepEqual(opened, ['']);
});

for (const outcome of ['resolve', 'reject']) {
  test(`a conflict refresh that ${outcome}s after account change cannot overwrite the new account status`, async () => {
    const read = deferred();
    const published = [];
    let current = true;
    const operation = refreshCurrentConflict({
      readRemote: () => read.promise,
      assertCurrent: () => {
        if (!current) throw new DOMException('Account changed', 'AbortError');
      },
      showRemote: (snapshot) => published.push(snapshot),
      showConflict: () => published.push('conflict'),
    });
    current = false;
    if (outcome === 'resolve') read.resolve({ revision: 9, snapshot: 'old-account' });
    else read.reject(new DOMException('Old request aborted', 'AbortError'));
    await assert.rejects(operation, { name: 'AbortError' });
    assert.deepEqual(published, []);
  });
}

test('a failed conflict detail read for the current account retains its verified copy and reports the conflict', async () => {
  const published = [];
  await refreshCurrentConflict({
    readRemote: async () => { throw new Error('Temporary connection failure'); },
    assertCurrent: () => {},
    showRemote: (snapshot) => published.push(snapshot),
    showConflict: () => published.push('conflict'),
  });
  assert.deepEqual(published, ['conflict']);
});
