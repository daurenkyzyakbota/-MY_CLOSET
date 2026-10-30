import { cloudConfigured, currentCloudUser } from '@/lib/cloud/auth-server.js';
import { socialService } from '@/lib/social/database.js';
import { createSocialHandlers } from '@/lib/social/handlers.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const { GET } = createSocialHandlers({
  configured: cloudConfigured,
  getUser: () => currentCloudUser({ fresh: true }),
  service: socialService,
});
