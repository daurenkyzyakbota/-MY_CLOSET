import { cloudConfigured, currentCloudUser, getAuthServer } from '@/lib/cloud/auth-server.js';
import { createAccountSessionHandlers } from '@/lib/cloud/account-sessions.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const { GET, POST } = createAccountSessionHandlers({
  configured: cloudConfigured,
  getUser: () => currentCloudUser({ fresh: true }),
  getSession: () => getAuthServer().getSession(),
  listSessions: () => getAuthServer().listSessions(),
  revokeSession: (token) => getAuthServer().revokeSession({ token }),
  report: (code) => console.error('MyCloset account sessions:', code),
});
