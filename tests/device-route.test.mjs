import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/device/route.js';

test('a wildcard Next.js bind address is local and uses the browser host', async () => {
  const response = GET(new Request('http://0.0.0.0:3007/api/device', {headers:{host:'localhost:3007'}}));
  const data = await response.json();
  assert.equal(data.isHosted, false);
  assert.equal(data.localUrl, 'http://localhost:3007/');
  assert.ok(data.phoneUrls.every(url => !url.includes('0.0.0.0') && !url.includes('localhost')));
});

test('the public device link retains the external hostname and HTTPS', async () => {
  const response = GET(new Request('http://0.0.0.0:3000/api/device', {headers:{host:'closet.example.com','x-forwarded-proto':'https'}}));
  const data = await response.json();
  assert.equal(data.isHosted, true);
  assert.deepEqual(data.phoneUrls, ['https://closet.example.com/']);
});
