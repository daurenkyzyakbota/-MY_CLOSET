import { database } from '../cloud/cloud-database.js';
import { createSocialService } from './service.js';

// The pool is initialized lazily, so local-only builds require no database secrets.
export const socialService = createSocialService({
  pool: {
    query: (...args) => database().query(...args),
    connect: (...args) => database().connect(...args),
  },
});
