import { currentNotificationUser } from '@/lib/notifications/auth.js';
import { notificationService } from '@/lib/notifications/database.js';
import { createNotificationHandlers } from '@/lib/notifications/handlers.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const { GET, PATCH } = createNotificationHandlers({
  getUser: currentNotificationUser, service: notificationService,
}).preferences;
