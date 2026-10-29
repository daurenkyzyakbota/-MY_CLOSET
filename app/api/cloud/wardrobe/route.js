import { currentCloudUser, cloudConfigured } from '@/lib/auth-server.js';
import { cloudStorage } from '@/lib/cloud-database.js';
import { createCloudHandlers } from '@/lib/cloud-handlers.js';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;
export const { GET, POST } = createCloudHandlers({ getUser: currentCloudUser, storage: cloudStorage, configured: cloudConfigured, report: code => console.error('MyCloset cloud request failed:', code) });
