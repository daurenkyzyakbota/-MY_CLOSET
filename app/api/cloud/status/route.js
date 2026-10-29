import { cloudConfigured } from '@/lib/auth-server.js';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET() { return Response.json({ configured: cloudConfigured() }, { headers: { 'Cache-Control': 'no-store' } }); }
