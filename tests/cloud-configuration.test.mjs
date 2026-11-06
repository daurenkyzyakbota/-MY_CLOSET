import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudConfigurationReader } from '../lib/cloud/cloud-configuration.js';

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test('an initial network failure can recover on a later configuration check without reloading the app', async () => {
  const results = [];
  const failures = [];
  let online = false;
  const reader = createCloudConfigurationReader({
    fetchStatus: async () => {
      if (!online) throw new Error('Offline');
      return { configured: true };
    },
    onResult: (value) => results.push(value),
    onError: (error) => failures.push(error.message),
  });
  assert.equal(await reader.check(), null);
  online = true;
  assert.deepEqual(await reader.check(), { configured: true });
  assert.deepEqual(results, [{ configured: true }]);
  assert.deepEqual(failures, ['Offline']);
  reader.close();
});

test('a stalled initial configuration check ends with a timeout instead of leaving the account loading forever', async () => {
  const failures = [];
  const reader = createCloudConfigurationReader({
    timeoutMs: 10,
    fetchStatus: ({ signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    }),
    onResult: () => assert.fail('A stalled request cannot succeed'),
    onError: (error) => failures.push(error.name),
  });
  assert.equal(await reader.check(), null);
  assert.deepEqual(failures, ['TimeoutError']);
  reader.close();
});

test('an older configuration result cannot overwrite a successful reconnect, even if transport ignores abort', async () => {
  const old = deferred();
  const results = [];
  const failures = [];
  let attempt = 0;
  const reader = createCloudConfigurationReader({
    fetchStatus: () => attempt++ === 0 ? old.promise : Promise.resolve({ configured: true }),
    onResult: (value) => results.push(value),
    onError: (error) => failures.push(error),
  });
  const stale = reader.check();
  await reader.check();
  old.resolve({ configured: false });
  assert.equal(await stale, null);
  assert.deepEqual(results, [{ configured: true }]);
  assert.deepEqual(failures, []);
  reader.close();
});

test('closing a provider aborts its check and prevents state publication after unmount', async () => {
  const request = deferred();
  let signal;
  const results = [];
  const reader = createCloudConfigurationReader({
    fetchStatus: (options) => {
      signal = options.signal;
      return request.promise;
    },
    onResult: (value) => results.push(value),
    onError: (error) => results.push(error),
  });
  const checking = reader.check();
  reader.close();
  assert.equal(signal.aborted, true);
  request.resolve({ configured: true });
  assert.equal(await checking, null);
  assert.equal(await reader.check(), null);
  assert.deepEqual(results, []);
});
