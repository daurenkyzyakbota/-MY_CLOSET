import test from 'node:test';
import assert from 'node:assert/strict';
import { GET } from '../app/api/device/route.js';
import { buildDeviceLinks } from '../lib/device-links.js';

function adapter(address, mac = '50:ee:32:96:a3:f0', extra = {}) {
  return { address, mac, family: 'IPv4', internal: false, ...extra };
}

function links(interfaces, host = 'localhost:3007') {
  return buildDeviceLinks(new Request('http://0.0.0.0:3007/api/device', { headers: { host } }), interfaces);
}

test('a wildcard Next.js bind address is local and uses the browser host', async () => {
  const response = GET(new Request('http://0.0.0.0:3007/api/device', {headers:{host:'localhost:3007'}}));
  const data = await response.json();
  assert.equal(data.isHosted, false);
  assert.equal(data.localUrl, 'http://localhost:3007/');
  assert.ok(data.phoneUrls.every(url => !url.includes('0.0.0.0') && !url.includes('localhost')));
  assert.equal(data.preferredPhoneUrl, data.phoneUrls[0] || '');
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
});

test('the public device link retains the external hostname and HTTPS', async () => {
  const response = GET(new Request('http://0.0.0.0:3000/api/device', {headers:{host:'closet.example.com','x-forwarded-proto':'https'}}));
  const data = await response.json();
  assert.equal(data.isHosted, true);
  assert.deepEqual(data.phoneUrls, ['https://closet.example.com/']);
  assert.equal(data.preferredPhoneUrl, 'https://closet.example.com/');
});

test('a VirtualBox host-only MAC is ranked below a localized physical Wi-Fi adapter', () => {
  const data = links({
    'Ethernet 2': [adapter('192.168.56.1', '0a:00:27:00:00:06')],
    'Беспроводная сеть': [adapter('192.168.10.3')],
  });
  assert.deepEqual(data.phoneUrls, ['http://192.168.10.3:3007/', 'http://192.168.56.1:3007/']);
  assert.equal(data.preferredPhoneUrl, 'http://192.168.10.3:3007/');
});

test('the current LAN host takes priority, including an explicitly used virtual adapter', () => {
  const interfaces = {
    Ethernet: [adapter('192.168.20.2')],
    WiFi: [adapter('192.168.10.3')],
    VirtualBox: [adapter('192.168.56.1', '08:00:27:00:00:01')],
  };
  assert.equal(links(interfaces, '192.168.10.3:4321').preferredPhoneUrl, 'http://192.168.10.3:4321/');
  assert.equal(links(interfaces, '192.168.56.1:4321').preferredPhoneUrl, 'http://192.168.56.1:4321/');
});

test('an unrecognized private Host is not invented as an interface address', () => {
  const data = links({ WiFi: [adapter('192.168.10.3')] }, '192.168.99.99:3007');
  assert.deepEqual(data.phoneUrls, ['http://192.168.10.3:3007/']);
});

test('known virtual MACs are ranked later without dropping any candidates', () => {
  const macs = ['08:00:27:00:00:01', '00-15-5D-00-00-01', '00:50:56:00:00:01', '00:0c:29:00:00:01', '00:05:69:00:00:01', '00:1c:14:00:00:01', '52:54:00:00:00:01'];
  for (const mac of macs) {
    const data = links({ Ethernet: [adapter('192.168.56.1', mac)], en0: [adapter('10.1.2.3')] });
    assert.deepEqual(data.phoneUrls, ['http://10.1.2.3:3007/', 'http://192.168.56.1:3007/'], mac);
  }
});

test('cross-platform virtual interface names are ranked later even with an unknown MAC', () => {
  for (const name of ['VirtualBox Host-Only Network', 'vEthernet (Default Switch)', 'VMware Network Adapter VMnet8', 'vboxnet0', 'qemu0', 'virbr0', 'docker0', 'br-abcd1234', 'utun0', 'tun0', 'Tailscale']) {
    const data = links({ [name]: [adapter('192.168.56.1', '')], en0: [adapter('10.1.2.3')] });
    assert.deepEqual(data.phoneUrls, ['http://10.1.2.3:3007/', 'http://192.168.56.1:3007/'], name);
  }
});

test('duplicates use their best rank while unrelated physical adapters keep their order', () => {
  const data = links({
    VirtualBox: [adapter('192.168.10.3')],
    Ethernet: [adapter('10.0.0.3')],
    WiFi: [adapter('192.168.10.3'), adapter('192.168.10.4')],
  });
  assert.deepEqual(data.phoneUrls, ['http://192.168.10.3:3007/', 'http://10.0.0.3:3007/', 'http://192.168.10.4:3007/']);
});

test('only valid private non-internal IPv4 addresses are offered to a phone', () => {
  const data = links({
    Loopback: [adapter('127.0.0.1', '', { internal: true })],
    other: [adapter('127.0.0.2'), adapter('0.0.0.0'), adapter('169.254.3.4'), adapter('8.8.8.8'), adapter('172.15.1.2'), adapter('172.32.1.2'), adapter('192.168.999.1'), adapter('fe80::1', '', { family: 'IPv6' }), adapter('10.1.2.3', '', { internal: true })],
    valid: [adapter('172.16.0.2'), adapter('172.31.255.254'), adapter('192.168.10.3'), adapter('10.0.0.1', '', { family: 4 })],
  });
  assert.deepEqual(data.phoneUrls, ['http://172.16.0.2:3007/', 'http://172.31.255.254:3007/', 'http://192.168.10.3:3007/', 'http://10.0.0.1:3007/']);
});

test('loopback and wildcard hosts stay local without creating unusable phone links', () => {
  for (const host of ['localhost:3007', '127.0.0.1:3007', '127.0.0.2:3007', '0.0.0.0:3007', '[::1]:3007', '[::]:3007']) {
    const data = links({}, host);
    assert.equal(data.isHosted, false, host);
    assert.deepEqual(data.phoneUrls, [], host);
    assert.equal(data.preferredPhoneUrl, '', host);
  }
});

test('when only virtual adapters exist they remain available rather than disappearing', () => {
  const data = links({ 'vEthernet (External Switch)': [adapter('192.168.56.1', '00:15:5d:00:00:01')] });
  assert.deepEqual(data.phoneUrls, ['http://192.168.56.1:3007/']);
  assert.equal(data.preferredPhoneUrl, data.phoneUrls[0]);
});

test('a public hostname is retained without exposing local interface addresses', () => {
  const data = links({ WiFi: [adapter('192.168.10.3')] }, '10.example.com:3007');
  assert.equal(data.isHosted, true);
  assert.deepEqual(data.phoneUrls, ['http://10.example.com:3007/']);
});
