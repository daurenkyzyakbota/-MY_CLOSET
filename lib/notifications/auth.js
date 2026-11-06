import { currentCloudUser, getAuthServer } from '../cloud/auth-server.js';

export async function currentNotificationUser() {
  const user = await currentCloudUser({ fresh: true });
  if (!user) return null;
  const result = await getAuthServer().getSession();
  if (result.error || result.data?.user?.id !== user.id || !result.data?.session?.id) return null;
  return { id: user.id, sessionId: result.data.session.id };
}
