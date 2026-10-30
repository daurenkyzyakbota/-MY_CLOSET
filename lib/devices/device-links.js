import { isIPv4 } from 'node:net';

const PRIVATE_IPV4 = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/;
const LOCAL_HOSTS = new Set(['localhost', '0.0.0.0', '[::1]', '[::]']);
const VIRTUAL_NAME =
  /virtual|vbox|vmware|vmnet|hyper[ -]?v|vethernet|qemu|parallels|docker|podman|wsl|vpn|tailscale|zerotier|hamachi|host[ -]?only|^(?:tun|tap|utun|veth|virbr|bridge)\d*\b|^br-/i;
const VIRTUAL_MAC_PREFIXES = new Set([
  '080027',
  '0a0027', // VirtualBox, including its host-only adapter.
  '00155d', // Hyper-V.
  '005056',
  '000c29',
  '000569',
  '001c14', // VMware.
  '525400', // QEMU.
]);

function privateIPv4(address) {
  return typeof address === 'string' && isIPv4(address) && PRIVATE_IPV4.test(address);
}

function virtualAdapter(name, adapter) {
  const mac =
    typeof adapter.mac === 'string' ? adapter.mac.replace(/[^a-f0-9]/gi, '').toLowerCase() : '';
  return (
    VIRTUAL_NAME.test(name) || (mac.length === 12 && VIRTUAL_MAC_PREFIXES.has(mac.slice(0, 6)))
  );
}

export function buildDeviceLinks(request, interfaces = {}) {
  const url = new URL(request.url);
  const host = request.headers.get('host');
  if (host && /^[a-z0-9.\[\]:-]+$/i.test(host)) {
    try {
      const address = new URL(`${url.protocol}//${host}`);
      url.hostname = address.hostname;
      url.port = address.port;
    } catch {}
  }
  const local =
    LOCAL_HOSTS.has(url.hostname) ||
    privateIPv4(url.hostname) ||
    (isIPv4(url.hostname) && url.hostname.startsWith('127.'));
  if (!local && request.headers.get('x-forwarded-proto') === 'https') url.protocol = 'https:';
  const localUrl = `${url.origin}/`;
  if (!local)
    return { localUrl, phoneUrls: [localUrl], preferredPhoneUrl: localUrl, isHosted: true };

  const candidates = new Map();
  let order = 0;
  for (const [name, adapters] of Object.entries(interfaces))
    for (const adapter of adapters || []) {
      if (
        !adapter ||
        adapter.internal ||
        (adapter.family !== 'IPv4' && adapter.family !== 4) ||
        !privateIPv4(adapter.address)
      )
        continue;
      // Interface names and MAC prefixes are hints, not a route/gateway probe.
      // Retain every address so the user can still choose a VPN/virtual network.
      const rank = adapter.address === url.hostname ? 0 : virtualAdapter(name, adapter) ? 2 : 1;
      const previous = candidates.get(adapter.address);
      if (!previous)
        candidates.set(adapter.address, { address: adapter.address, rank, order: order++ });
      else if (rank < previous.rank) previous.rank = rank;
    }
  const phoneUrls = [...candidates.values()]
    .sort((a, b) => a.rank - b.rank || a.order - b.order)
    .map(({ address }) => `${url.protocol}//${address}${url.port ? `:${url.port}` : ''}/`);
  return { localUrl, phoneUrls, preferredPhoneUrl: phoneUrls[0] || '', isHosted: false };
}
