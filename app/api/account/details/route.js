import { cloudConfigured, currentCloudUser, getAuthServer } from '@/lib/cloud/auth-server.js';
import { database } from '@/lib/cloud/cloud-database.js';
import { createAccountHandlers } from '@/lib/cloud/account-handlers.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const { GET, PATCH } = createAccountHandlers({
  configured: cloudConfigured,
  getUser: () => currentCloudUser({ fresh: true }),
  readUser: async (userId) => {
    const { rows } = await database().query(
      'SELECT id, name, email FROM neon_auth."user" WHERE id=$1::uuid',
      [userId],
    );
    return rows[0] || null;
  },
  updateName: (name) => getAuthServer().updateUser({ name }),
  report: (code) => console.error('MyCloset account details:', code),
});
