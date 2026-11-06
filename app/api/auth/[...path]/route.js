import { cloudConfigured, getAuthServer } from '@/lib/cloud/auth-server.js';
import { createAuthHandlers } from '@/lib/cloud/auth-handlers.js';
import {
  normalizeEmailAddress,
  validateRegistrationEmailDomain,
  validateRegistrationInput,
} from '@/lib/cloud/email-validation.js';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const { GET, POST, PUT, PATCH, DELETE } = createAuthHandlers({
  configured: cloudConfigured,
  proxy: (method, request, context) => getAuthServer().handler()[method](request, context),
  validateRegistrationInput,
  normalizeEmailAddress,
  validateEmailDomain: validateRegistrationEmailDomain,
  report: (code) => console.error('MyCloset auth:', code),
});
