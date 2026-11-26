import { ECDH } from 'node:crypto';
import { pushEndpoint } from './validation.js';

function validPublicKey(key) {
  if (!/^[A-Za-z0-9_-]{87}$/.test(key)) return false;
  try {
    return ECDH.convertKey(key, 'prime256v1', 'base64url', 'base64url') === key;
  } catch {
    return false;
  }
}

export function pushConfiguration(environment = process.env) {
  const publicKey = environment.MYCLOSET_PUSH_PUBLIC_KEY || '';
  const privateKey = environment.MYCLOSET_PUSH_PRIVATE_KEY || '';
  const subject = environment.MYCLOSET_PUSH_SUBJECT || '';
  const validKey = validPublicKey(publicKey);
  const available = validKey && /^[A-Za-z0-9_-]{43}$/.test(privateKey) &&
    /^(?:https:\/\/[^\s]+|mailto:[^\s@]+@[^\s@]+)$/.test(subject);
  const subscriptionAvailable = validKey && (available || !privateKey);
  return { available, subscriptionAvailable, publicKey: subscriptionAvailable ? publicKey : '', privateKey, subject };
}

export async function sendWebPush(subscription, payload, { configuration = pushConfiguration(), fetcher = fetch, build } = {}) {
  if (!configuration.available) return { status: 'unavailable' };
  const endpoint = pushEndpoint(subscription.endpoint);
  const data = JSON.stringify(payload);
  if (new TextEncoder().encode(data).length > 2048) throw new Error('Notification payload exceeds its bound.');
  const buildPayload = build || (await import('@block65/webcrypto-web-push')).buildPushPayload;
  const request = await buildPayload({ data, options: { ttl: 3600, urgency: 'normal' } }, subscription, {
    publicKey: configuration.publicKey, privateKey: configuration.privateKey, subject: configuration.subject,
  });
  const response = await fetcher(endpoint, { ...request, redirect: 'manual', signal: AbortSignal.timeout(5000) });
  if (response.status === 404 || response.status === 410) return { status: 'expired' };
  return { status: response.ok ? 'sent' : 'failed' };
}
