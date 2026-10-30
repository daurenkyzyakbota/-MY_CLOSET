import { cloudConfigured, getAuthServer } from '@/lib/cloud/auth-server.js';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
function handle(method) {
  return async (request, context) => {
    if (!cloudConfigured())
      return Response.json(
        { error: { message: 'Облачное подключение ещё не настроено.' } },
        {
          status: 503,
          headers: { 'Cache-Control': 'private, no-store, max-age=0', Vary: 'Cookie' },
        },
      );
    const response = await getAuthServer().handler()[method](request, context);
    response.headers.set('Cache-Control', 'private, no-store, max-age=0');
    const vary = response.headers.get('Vary') || '';
    if (!vary.split(',').some((value) => value.trim().toLowerCase() === 'cookie'))
      response.headers.set('Vary', [vary, 'Cookie'].filter(Boolean).join(', '));
    return response;
  };
}
export const GET = handle('GET');
export const POST = handle('POST');
export const PUT = handle('PUT');
export const PATCH = handle('PATCH');
export const DELETE = handle('DELETE');
