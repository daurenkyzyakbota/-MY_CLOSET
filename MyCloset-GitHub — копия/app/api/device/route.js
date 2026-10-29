export const dynamic = 'force-dynamic';

export async function GET(request) {
  const address = new URL('/', request.url).href;
  return Response.json({
    localUrl: address,
    phoneUrls: [address],
    preferredPhoneUrl: address,
    hostedUrl: address,
    isHosted: true
  }, { headers: { 'Cache-Control': 'no-store' } });
}