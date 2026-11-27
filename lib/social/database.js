import { database } from '../cloud/cloud-database.js';
import { createSocialService } from './service.js';
import { notificationService } from '../notifications/database.js';
import { rolesSchemaGuard } from './roles-schema.js';
import { ensureSocialPlusSchema } from './social-plus-schema.js';

const ensureRoles = rolesSchemaGuard(database, (code) => console.warn('MyCloset social:', code));
let socialPlus = null;
// Roles (007) first, then follows/polls/replies/messages (008); each runs once per server.
const ensureSchema = async () => {
  await ensureRoles();
  await (socialPlus ||= ensureSocialPlusSchema(database()).then(
    (applied) => {
      if (applied) console.warn('MyCloset social:', 'SOCIAL_PLUS_MIGRATION_APPLIED');
    },
    (error) => {
      socialPlus = null;
      throw error;
    },
  ));
};

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
  afterCommit: ({ action, result }) =>
    action === 'messages.send' ? notificationService.message(result.message.id) : null,
  report: (code) => console.warn('MyCloset social notification:', code),
});
