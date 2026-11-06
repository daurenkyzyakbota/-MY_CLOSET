import { currentCloudUser, cloudConfigured } from '@/lib/cloud/auth-server.js';
import { cloudStorage } from '@/lib/cloud/cloud-database.js';
import { createCloudHandlers } from '@/lib/cloud/cloud-handlers.js';
import { photoStorage } from '@/lib/cloud/photo-storage.js';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const { GET, POST } = createCloudHandlers({
  getUser: () => currentCloudUser({ fresh: true }),
  storage: cloudStorage,
  photos: photoStorage,
  configured: cloudConfigured,
  report: (code) => console.error('MyCloset cloud request failed:', code),
});
