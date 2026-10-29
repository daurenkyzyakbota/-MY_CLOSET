import { networkInterfaces } from 'node:os';
import { buildDeviceLinks } from '../../../lib/device-links.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET(request) {
  return Response.json(buildDeviceLinks(request, networkInterfaces()), { headers: { 'Cache-Control': 'no-store' } });
}
