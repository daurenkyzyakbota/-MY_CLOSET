import { database } from '../cloud/cloud-database.js';
import { createSocialService } from './service.js';
import { notificationService } from '../notifications/database.js';
import { rolesSchemaGuard } from './roles-schema.js';

const ensureSchema = rolesSchemaGuard(database, (code) => console.warn('MyCloset social:', code));

// The pool is initialized lazily, so local-only builds require no database secrets.
export const socialService = createSocialService({
  pool: {
    query: async (...args) => {
      await ensureSchema();
      return database().query(...args);
    },
    connect: async (...args) => {
      await ensureSchema();
      return database().connect(...args);
    },
  },
  afterCommit: ({ action, result }) => action === 'messages.send'
    ? notificationService.message(result.message.id)
    : null,
  report: (code) => console.warn('MyCloset social notification:', code),
});
