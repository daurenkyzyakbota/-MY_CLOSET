import { database } from '../cloud/cloud-database.js';
import { createNotificationService } from './service.js';

export const notificationService = createNotificationService({ pool: {
  query: (...args) => database().query(...args),
  connect: (...args) => database().connect(...args),
} });
