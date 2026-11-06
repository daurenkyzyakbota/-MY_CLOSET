import { parseTriggerDelivery } from '@neon/functions/triggers';

const MAX_BODY_BYTES = 64 * 1024;
const TRIGGER_HEADER = 'x-neon-trigger-invocation-id';
const PRIVATE_HEADERS = { 'Cache-Control': 'private, no-store, max-age=0' };
const reply = (error, status, headers = {}) => Response.json(
  error ? { ok: false, error } : { ok: true },
  { status, headers: { ...PRIVATE_HEADERS, ...headers } },
);
const retry = () => reply('dispatch_unavailable', 503, { 'Retry-After': '60' });

export function dispatchConfiguration(environment) {
  const secret = environment?.MYCLOSET_NOTIFICATION_CRON_SECRET;
  const address = environment?.MYCLOSET_NOTIFICATION_DISPATCH_URL;
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 512 || /[\s\u0000-\u001f\u007f]/u.test(secret)) return null;
  if (typeof address !== 'string' || address.length > 2048) return null;
  try {
    const url = new URL(address);
    if (
      url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.port || url.pathname !== '/api/notifications/dispatch' ||
      !/^[a-z0-9.-]+$/i.test(url.hostname) || !url.hostname.includes('.') ||
      url.hostname.endsWith('.localhost') || /^[\d.]+$/.test(url.hostname)
    ) return null;
    return { address: url.href, secret };
  } catch { return null; }
}

function validSchedule(invocation) {
  if (invocation.type !== 'schedule') return false;
  for (const value of [invocation.invocationId, invocation.trigger.id, invocation.trigger.name])
    if (value.length > 256 || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  const value = invocation.data.scheduledAt;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) return false;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 19) === value.slice(0, 19);
}

async function readBody(request) {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) return { error: 'payload_too_large', status: 413 };
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) return { error: 'invalid_payload', status: 415 };
  const reader = request.body?.getReader();
  if (!reader) return { error: 'invalid_payload', status: 400 };
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        void reader.cancel().catch(() => {});
        return { error: 'payload_too_large', status: 413 };
      }
      chunks.push(value);
    }
    return { body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
  } catch { return { error: 'invalid_payload', status: 400 }; }
  finally { reader.releaseLock(); }
}

/** Deploy only behind Neon's native Functions proxy, which strips public x-neon-* headers. */
export function createNotificationCron({
  environment = () => process.env,
  fetchImpl = (...args) => fetch(...args),
  timeoutMs = 15000,
  report = (event) => console.info(JSON.stringify(event)),
} = {}) {
  const record = (phase, status) => {
    // Static phase names and numeric HTTP statuses only: no request, payload,
    // environment, downstream body or exception reaches the reporter.
    try { if (typeof report === 'function') report({ phase, status }); }
    catch { /* Logging must not affect authorization or retry behavior. */ }
  };
  const reject = (phase, error, status, headers) => {
    record(phase, status);
    return reply(error, status, headers);
  };
  return {
    async fetch(request) {
      try {
        if (new URL(request.url).pathname !== '/cron') return reject('route_rejected', 'not_found', 404);
        if (request.method !== 'POST') return reject('method_rejected', 'method_not_allowed', 405, { Allow: 'POST' });
        // Reject arbitrary HTTP before reading JSON or inspecting server secrets.
        // The value is a correlation ID, never an application secret or JWT.
        if (!request.headers.get(TRIGGER_HEADER)?.trim()) return reject('provenance_rejected', 'unauthorized', 401);
        const input = await readBody(request);
        if (input.error) return reject('body_rejected', input.error, input.status);
        const parsed = parseTriggerDelivery({ headers: request.headers, body: input.body });
        if (!parsed.ok) return reject('parser_rejected', parsed.error === 'invalid_body' ? 'invalid_payload' : 'unauthorized', parsed.error === 'invalid_body' ? 400 : 401);
        if (!validSchedule(parsed.invocation)) return reject('schedule_rejected', 'invalid_payload', 400);
        const configuration = dispatchConfiguration(environment());
        if (!configuration) { record('configuration_retry', 503); return retry(); }
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await fetchImpl(configuration.address, {
            method: 'POST',
            headers: { Authorization: `Bearer ${configuration.secret}`, 'Content-Length': '0' },
            redirect: 'manual',
            signal: controller.signal,
          });
          // A response preview can contain provider details. Never read, return
          // or log it: Neon retains failed responses in its retry history.
          void response.body?.cancel().catch(() => {});
          record('downstream', response.status);
          return response.ok ? reply(null, 200) : retry();
        } catch { record('network_retry', 503); return retry(); }
        finally { clearTimeout(timer); controller.abort(); }
      } catch { record('handler_retry', 503); return retry(); }
    },
  };
}

export default createNotificationCron();
