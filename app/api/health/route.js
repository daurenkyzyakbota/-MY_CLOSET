export const dynamic = 'force-dynamic';

// Liveness only: a sleeping database must not trigger a web server restart.
export function GET() {
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
