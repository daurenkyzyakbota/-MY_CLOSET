import { networkInterfaces } from 'node:os';
import { buildDeviceLinks } from '../../../lib/devices/device-links.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request) {
  const loopbackOnly = process.env.MYCLOSET_LOCAL_LOOPBACK === '1';
  const links = buildDeviceLinks(request, loopbackOnly ? {} : networkInterfaces());
  return Response.json(loopbackOnly && !links.isHosted ? { ...links, loopbackOnly } : links, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
