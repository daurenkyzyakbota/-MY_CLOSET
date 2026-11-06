import { currentCloudUser, cloudConfigured } from '@/lib/cloud/auth-server.js';
import { photosConfigured, photoStorage } from '@/lib/cloud/photo-storage.js';
import { createPhotoHandlers } from '@/lib/cloud/photo-handlers.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const { GET, POST } = createPhotoHandlers({
  getUser: () => currentCloudUser({ fresh: true }),
  storage: photoStorage,
  configured: () => cloudConfigured() && photosConfigured(),
  report: (code) => console.error('MyCloset photo storage:', code),
});
