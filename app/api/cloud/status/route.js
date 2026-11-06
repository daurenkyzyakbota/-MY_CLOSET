import { cloudConfigured } from '@/lib/cloud/auth-server.js';
import { photosConfigured } from '@/lib/cloud/photo-storage.js';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json(
    {
      configured: cloudConfigured(),
      photos: photosConfigured(),
      accountDeletionAvailable: process.env.MYCLOSET_ACCOUNT_DELETION_ENABLED === 'true',
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
