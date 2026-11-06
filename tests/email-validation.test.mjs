import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EmailValidationError,
  normalizeEmailAddress,
  validateRegistrationInput,
  createEmailDomainValidator,
} from '../lib/cloud/email-validation.js';

const dnsError = (code) => Object.assign(new Error('DNS response'), { code });
const absent = async () => { throw dnsError('ENODATA'); };
const mx = [{ priority: 10, exchange: 'mx.mail-company.kz' }];
const queries = (overrides = {}) => ({ resolveMx: absent, resolve4: absent, resolve6: absent, ...overrides });
const registration = (overrides = {}) => ({
  name: 'Амина',
  email: 'amina@mail-company.kz',
  password: 'password123',
  ...overrides,
});

test('email normalization retains plus tags and dots, supports IDNA domains and matches Better Auth case normalization', () => {
  assert.deepEqual(normalizeEmailAddress(' User.Name+Tag@MAIL-COMPANY.KZ '), {
    email: 'user.name+tag@mail-company.kz',
    domain: 'mail-company.kz',
  });
  assert.deepEqual(normalizeEmailAddress('User@ПРИМЕР.РФ'), {
    email: 'user@xn--e1afmkfd.xn--p1ai',
    domain: 'xn--e1afmkfd.xn--p1ai',
  });
  assert.equal(normalizeEmailAddress("O'Brien@mail-company.kz").email, "o'brien@mail-company.kz");
});

test('malformed addresses, controls, IP literals, invalid DNS labels and oversized addresses fail without DNS', () => {
  for (const value of [
    null, 10, {}, '', 'no-at-sign', 'a@@mail.kz', '@mail.kz', 'a@',
    '.a@mail.kz', 'a.@mail.kz', 'a..b@mail.kz', 'a b@mail.kz',
    'a@mail..kz', 'a@-mail.kz', 'a@mail-.kz', 'a@mail_kz.com',
    'a@[127.0.0.1]', 'a@127.0.0.1', 'a@localhost', 'a@mail.kz.',
    'a@https://mail.kz', 'a@mail.kz/path', 'a@mail.kz\n',
    'a\u0000@mail.kz', 'a@%6dail.kz', `${'a'.repeat(65)}@mail.kz`,
    `a@${'b'.repeat(64)}.kz`, `a@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.${'e'.repeat(63)}.kz`,
  ]) {
    assert.throws(() => normalizeEmailAddress(value), (error) =>
      error instanceof EmailValidationError && error.status === 400,
    );
  }
});

test('reserved example and special-use suffixes are rejected, without blocking arbitrary corporate providers', () => {
  for (const domain of [
    'example.com', 'sub.example.net', 'example.org', 'mail.test', 'mail.invalid',
    'mail.example', 'mail.local', 'mail.localhost', 'mail.internal', 'mail.onion', 'home.arpa',
  ]) {
    assert.throws(() => normalizeEmailAddress(`user@${domain}`), {
      status: 422,
      code: 'RESERVED_EMAIL_DOMAIN',
    });
  }
  assert.equal(normalizeEmailAddress('user@example.com.company.kz').domain, 'example.com.company.kz');
});

test('pure registration validation preserves legal SDK fields and password bytes while validating bounded names/passwords', () => {
  const original = registration({
    name: ' Амина ',
    email: ' User@MAIL-COMPANY.KZ ',
    password: '  secret12  ',
    callbackURL: 'http://localhost:3000/account',
    rememberMe: false,
    image: 'https://mail-company.kz/avatar.png',
  });
  const result = validateRegistrationInput(original);
  assert.deepEqual(result, { ...original, name: 'Амина', email: 'user@mail-company.kz' });
  assert.equal(original.email, ' User@MAIL-COMPANY.KZ ');
  for (const body of [null, [], registration({ name: '' }), registration({ name: 'a'.repeat(81) })])
    assert.throws(() => validateRegistrationInput(body), { status: 400 });
  assert.throws(() => validateRegistrationInput(registration({ password: 'a'.repeat(7) })), {
    code: 'PASSWORD_TOO_SHORT',
  });
  assert.throws(() => validateRegistrationInput(registration({ password: 'a'.repeat(129) })), {
    code: 'PASSWORD_TOO_LONG',
  });
  assert.equal(validateRegistrationInput(registration({ password: 'a'.repeat(8) })).password.length, 8);
  assert.equal(validateRegistrationInput(registration({ password: 'a'.repeat(128) })).password.length, 128);
});

test('registration rejects unexpected privilege, verification and provider fields instead of forwarding them', () => {
  for (const field of ['role', 'emailVerified', 'isAdmin', 'userId', 'providerId']) {
    assert.throws(() => validateRegistrationInput(registration({ [field]: true })), {
      status: 400,
      code: 'INVALID_REGISTRATION',
    });
  }
  const prototypeField = JSON.parse('{"__proto__":{"role":"admin"}}');
  assert.throws(() => validateRegistrationInput({ ...registration(), ...prototypeField }), {
    status: 400,
    code: 'INVALID_REGISTRATION',
  });
});

test('a real MX route is accepted without resolving host addresses or claiming that a mailbox exists', async () => {
  const calls = [];
  const validate = createEmailDomainValidator(queries({
    resolveMx: async (domain) => { calls.push(domain); return mx; },
    resolve4: async () => { throw new Error('Unexpected fallback'); },
    resolve6: async () => { throw new Error('Unexpected fallback'); },
  }));
  assert.deepEqual(await validate('MAIL-COMPANY.KZ'), { domain: 'mail-company.kz', mailRoute: 'mx' });
  assert.deepEqual(calls, ['mail-company.kz']);
});

test('null MX and NXDOMAIN reject definitively and never fall back to A/AAAA', async () => {
  for (const resolveMx of [
    async () => [{ priority: 0, exchange: '.' }],
    async () => [{ priority: 0, exchange: '' }],
    async () => { throw dnsError('ENOTFOUND'); },
  ]) {
    let fallback = 0;
    const validate = createEmailDomainValidator(queries({
      resolveMx,
      resolve4: async () => { fallback++; return ['192.0.2.1']; },
      resolve6: async () => { fallback++; return ['2001:db8::1']; },
    }));
    await assert.rejects(validate('mail-company.kz'), { status: 422 });
    assert.equal(fallback, 0);
  }
});

test('missing MX permits the RFC implicit MX fallback for either A or AAAA, including unknown corporate domains', async () => {
  for (const resolveMx of [absent, async () => []]) {
    for (const addresses of [{ resolve4: async () => ['192.0.2.1'] }, { resolve6: async () => ['2001:db8::1'] }]) {
      const validate = createEmailDomainValidator(queries({ resolveMx, ...addresses }));
      assert.deepEqual(await validate('unknown-corporate.kz'), {
        domain: 'unknown-corporate.kz',
        mailRoute: 'address',
      });
    }
  }
  const validate = createEmailDomainValidator(queries());
  await assert.rejects(validate('no-mail.kz'), { status: 422, code: 'EMAIL_DOMAIN_NO_MAIL' });
});

test('temporary DNS errors remain retryable 503 errors, rather than rejecting a working email as invalid', async () => {
  for (const code of ['ESERVFAIL', 'ETIMEOUT', 'ECONNREFUSED', 'EREFUSED']) {
    const validate = createEmailDomainValidator(queries({
      resolveMx: async () => { throw dnsError(code); },
    }));
    await assert.rejects(validate('mail-company.kz'), {
      status: 503,
      code: 'EMAIL_DNS_UNAVAILABLE',
      retryAfter: 15,
    });
  }
  const fallbackFailure = createEmailDomainValidator(queries({
    resolve4: async () => { throw dnsError('ESERVFAIL'); },
  }));
  await assert.rejects(fallbackFailure('mail-company.kz'), { status: 503 });
});

test('domain checks time out within a bound and one valid address does not wait for a hanging alternate family', async () => {
  const hanging = () => new Promise(() => {});
  const validate = createEmailDomainValidator(queries({ resolveMx: hanging, timeoutMs: 10 }));
  await assert.rejects(validate('mail-company.kz'), { status: 503, code: 'EMAIL_DNS_UNAVAILABLE' });
  const fallback = createEmailDomainValidator(queries({
    resolve4: async () => ['192.0.2.1'],
    resolve6: hanging,
    timeoutMs: 10,
  }));
  assert.equal((await fallback('mail-company.kz')).mailRoute, 'address');
});

test('positive and negative DNS results use separate expiring cache entries and same-domain requests deduplicate', async () => {
  let clock = 1000;
  let calls = 0;
  let resolvePending;
  const validate = createEmailDomainValidator(queries({
    now: () => clock,
    ttlMs: 100,
    negativeTtlMs: 20,
    resolveMx: (domain) => {
      calls++;
      if (domain === 'pending.kz') return new Promise((resolve) => { resolvePending = resolve; });
      if (domain === 'no-mail.kz') throw dnsError('ENOTFOUND');
      return mx;
    },
  }));
  const pending = [validate('pending.kz'), validate('PENDING.KZ')];
  assert.equal(calls, 1);
  resolvePending(mx);
  await Promise.all(pending);
  await validate('pending.kz');
  assert.equal(calls, 1);
  clock += 101;
  await validate('mail-company.kz');
  assert.equal(calls, 2);
  await assert.rejects(validate('no-mail.kz'), { status: 422 });
  await assert.rejects(validate('no-mail.kz'), { status: 422 });
  assert.equal(calls, 3);
  clock += 21;
  await assert.rejects(validate('no-mail.kz'), { status: 422 });
  assert.equal(calls, 4);
});

test('transient cache expires quickly, completed cache stays bounded and pending requests are capped', async () => {
  let clock = 0;
  let calls = 0;
  const validate = createEmailDomainValidator(queries({
    now: () => clock,
    transientTtlMs: 5,
    maxEntries: 1,
    resolveMx: async (domain) => {
      calls++;
      if (domain === 'temporary.kz') throw dnsError('ESERVFAIL');
      return mx;
    },
  }));
  await assert.rejects(validate('temporary.kz'), { status: 503 });
  await assert.rejects(validate('temporary.kz'), { status: 503 });
  assert.equal(calls, 1);
  clock += 6;
  await assert.rejects(validate('temporary.kz'), { status: 503 });
  assert.equal(calls, 2);
  await validate('one.kz');
  await validate('two.kz');
  await validate('one.kz');
  assert.equal(calls, 5);

  let resolvePending;
  const capped = createEmailDomainValidator(queries({
    maxPending: 1,
    resolveMx: () => new Promise((resolve) => { resolvePending = resolve; }),
  }));
  const first = capped('one.kz');
  const identical = capped('ONE.KZ');
  await assert.rejects(capped('two.kz'), { status: 503 });
  resolvePending(mx);
  await Promise.all([first, identical]);
});
