import { Resolver } from 'node:dns/promises';
import { isIP } from 'node:net';
import { domainToASCII } from 'node:url';

const reservedSuffixes = [
  'localhost',
  'local',
  'invalid',
  'test',
  'example',
  'internal',
  'onion',
  'alt',
  'home.arpa',
  'example.com',
  'example.net',
  'example.org',
];
const absentCodes = new Set(['ENODATA', 'ENOTFOUND']);
const signupFields = new Set(['name', 'email', 'password', 'callbackURL', 'rememberMe', 'image']);

export class EmailValidationError extends Error {
  constructor(status, code, message, retryAfter) {
    super(message);
    this.name = 'EmailValidationError';
    this.status = status;
    this.code = code;
    if (retryAfter) this.retryAfter = retryAfter;
  }
}

function invalidEmail() {
  return new EmailValidationError(400, 'INVALID_EMAIL', 'Введите корректный адрес электронной почты.');
}

function normalizeDomain(value) {
  if (typeof value !== 'string' || /[\s\u0000-\u001f\u007f%/:\\?#\[\]@]/u.test(value))
    throw invalidEmail();
  const domain = domainToASCII(value).toLowerCase();
  const labels = domain.split('.');
  if (
    !domain ||
    domain.length > 253 ||
    labels.length < 2 ||
    labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label)) ||
    /^\d+$/.test(labels.at(-1))
  )
    throw invalidEmail();
  if (reservedSuffixes.some((suffix) => domain === suffix || domain.endsWith(`.${suffix}`)))
    throw new EmailValidationError(
      422,
      'RESERVED_EMAIL_DOMAIN',
      'Этот домен используется для примеров или локальной сети. Укажите свою настоящую почту.',
    );
  return domain;
}

export function normalizeEmailAddress(value) {
  if (
    typeof value !== 'string' ||
    value.length > 1024 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  )
    throw invalidEmail();
  const input = value.trim();
  const parts = input.split('@');
  if (parts.length !== 2) throw invalidEmail();
  const local = parts[0];
  if (
    !local ||
    local.length > 64 ||
    !/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/i.test(local)
  )
    throw invalidEmail();
  const domain = normalizeDomain(parts[1]);
  // Better Auth also stores account identifiers in lowercase. Keep its identity
  // normalization, without rewriting provider-specific dots or plus tags.
  const email = `${local.toLowerCase()}@${domain}`;
  if (email.length > 254) throw invalidEmail();
  return { email, domain };
}

export function validateRegistrationInput(body) {
  if (
    !body ||
    typeof body !== 'object' ||
    Array.isArray(body) ||
    Object.keys(body).some((key) => !signupFields.has(key))
  )
    throw new EmailValidationError(400, 'INVALID_REGISTRATION', 'Проверьте данные регистрации.');
  const { email } = normalizeEmailAddress(body.email);
  if (
    typeof body.name !== 'string' ||
    !body.name.trim() ||
    body.name.trim().length > 80 ||
    /[\u0000-\u001f\u007f]/u.test(body.name)
  )
    throw new EmailValidationError(400, 'INVALID_NAME', 'Укажите имя длиной от 1 до 80 символов.');
  if (typeof body.password !== 'string' || body.password.length < 8)
    throw new EmailValidationError(
      400,
      'PASSWORD_TOO_SHORT',
      'Пароль должен содержать не менее 8 символов.',
    );
  if (body.password.length > 128)
    throw new EmailValidationError(
      400,
      'PASSWORD_TOO_LONG',
      'Пароль должен содержать не более 128 символов.',
    );
  return { ...body, email, name: body.name.trim() };
}

function unavailable() {
  return new EmailValidationError(
    503,
    'EMAIL_DNS_UNAVAILABLE',
    'Сейчас не удалось проверить почтовый домен. Повторите регистрацию немного позже.',
    15,
  );
}

function noMail(code = 'EMAIL_DOMAIN_NO_MAIL') {
  return new EmailValidationError(
    422,
    code,
    code === 'EMAIL_DOMAIN_NOT_FOUND'
      ? 'Почтовый домен не найден. Проверьте адрес электронной почты.'
      : 'Этот домен не принимает почту. Укажите другой адрес электронной почты.',
  );
}

export function createEmailDomainValidator({
  resolveMx,
  resolve4,
  resolve6,
  now = Date.now,
  timeoutMs = 3000,
  ttlMs = 300000,
  negativeTtlMs = 60000,
  transientTtlMs = 5000,
  maxEntries = 256,
  maxPending = 32,
} = {}) {
  const cache = new Map();
  const pending = new Map();

  async function lookup(domain) {
    const resolver = new Resolver({ timeout: timeoutMs, tries: 1 });
    const mxQuery = resolveMx || resolver.resolveMx.bind(resolver);
    const addressQueries = [
      [resolve4 || resolver.resolve4.bind(resolver), 4],
      [resolve6 || resolver.resolve6.bind(resolver), 6],
    ];
    let timer;
    const work = async () => {
      let records;
      try {
        records = await mxQuery(domain);
      } catch (cause) {
        if (cause.code === 'ENOTFOUND') throw noMail('EMAIL_DOMAIN_NOT_FOUND');
        if (cause.code !== 'ENODATA') throw unavailable();
        records = [];
      }
      if (!Array.isArray(records)) throw unavailable();
      // RFC 7505: a null MX explicitly forbids the A/AAAA fallback.
      if (records.some((record) => record?.exchange === '.' || record?.exchange === ''))
        throw noMail();
      if (records.length) {
        if (records.some((record) => typeof record?.exchange !== 'string')) throw unavailable();
        return { domain, mailRoute: 'mx' };
      }
      // RFC 5321 section 5.1: when MX is absent, the host's A or AAAA
      // address is an implicit MX. A provider allowlist would reject valid mail.
      try {
        await Promise.any(addressQueries.map(([query, family]) =>
          Promise.resolve().then(() => query(domain)).then((addresses) => {
            if (Array.isArray(addresses) && addresses.some((address) => isIP(address) === family))
              return;
            throw Object.assign(new Error('No address records'), { code: 'ENODATA' });
          }),
        ));
        return { domain, mailRoute: 'address' };
      } catch (cause) {
        if (cause.errors?.some((error) => !absentCodes.has(error?.code))) throw unavailable();
        throw noMail();
      }
    };
    try {
      return await Promise.race([
        work(),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(unavailable()), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      resolver.cancel();
    }
  }

  return async (value) => {
    const domain = normalizeDomain(value);
    const time = now();
    for (const [key, entry] of cache) if (entry.expiresAt <= time) cache.delete(key);
    const cached = cache.get(domain);
    if (cached) {
      if (cached.error) throw cached.error;
      return { ...cached.result };
    }
    if (pending.has(domain)) return pending.get(domain);
    if (pending.size >= maxPending) throw unavailable();
    const remember = (entry, ttl) => {
      if (cache.size >= maxEntries) cache.delete(cache.keys().next().value);
      cache.set(domain, { ...entry, expiresAt: now() + ttl });
    };
    const operation = lookup(domain).then(
      (result) => {
        remember({ result }, ttlMs);
        return { ...result };
      },
      (error) => {
        const failure = error instanceof EmailValidationError ? error : unavailable();
        remember({ error: failure }, failure.status === 503 ? transientTtlMs : negativeTtlMs);
        throw failure;
      },
    ).finally(() => pending.delete(domain));
    pending.set(domain, operation);
    return operation;
  };
}

// DNS confirms a possible mail route, never ownership or mailbox existence.
export const validateRegistrationEmailDomain = createEmailDomainValidator();
