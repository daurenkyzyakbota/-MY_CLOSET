import { cloudConfigured } from '@/lib/cloud/auth-server.js';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json(
    { configured: cloudConfigured() },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
