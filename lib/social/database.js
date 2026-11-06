import { database } from '../cloud/cloud-database.js';
import { createSocialService } from './service.js';
import { notificationService } from '../notifications/database.js';

// The pool is initialized lazily, so local-only builds require no database secrets.
export const socialService = createSocialService({
  pool: {
    query: (...args) => database().query(...args),
    connect: (...args) => database().connect(...args),
  },
  afterCommit: ({ action, result }) => action === 'messages.send'
    ? notificationService.message(result.message.id)
    : null,
  report: (code) => console.warn('MyCloset social notification:', code),
});
