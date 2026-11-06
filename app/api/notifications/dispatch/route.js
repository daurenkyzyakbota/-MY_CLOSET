import { notificationService } from '@/lib/notifications/database.js';
import { createNotificationHandlers } from '@/lib/notifications/handlers.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const { POST } = createNotificationHandlers({
  getUser: async () => null, service: notificationService,
}).dispatch;
