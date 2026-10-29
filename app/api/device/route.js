import { networkInterfaces } from 'node:os';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request) {
  const url = new URL(request.url);
  const host = request.headers.get('host');
  if (host && /^[a-z0-9.\[\]:-]+$/i.test(host)) {
    try { const address = new URL(`${url.protocol}//${host}`); url.hostname = address.hostname; url.port = address.port; } catch {}
  }
  const local = ['localhost', '0.0.0.0', '127.0.0.1', '[::1]', '[::]'].includes(url.hostname) || /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname);
  if (!local && request.headers.get('x-forwarded-proto') === 'https') url.protocol = 'https:';
  const addresses = new Set();
  if (local) for (const adapters of Object.values(networkInterfaces())) for (const adapter of adapters || []) {
    if (adapter.family === 'IPv4' && !adapter.internal && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(adapter.address)) addresses.add(`${url.protocol}//${adapter.address}${url.port ? `:${url.port}` : ''}/`);
  }
  return Response.json({ localUrl: `${url.origin}/`, phoneUrls: local ? [...addresses] : [`${url.origin}/`], isHosted: !local }, { headers: { 'Cache-Control': 'no-store' } });
}
