import { IncomingMessage, ServerResponse } from 'node:http';
import { Socket } from 'node:net';
import { Prisma } from '../generated/prisma/client.js';
import {
  LOG_SANITIZE_OPTIONS,
  REDACTED,
  sanitizeAuditValue,
  sanitizeValue,
  SENSITIVE_KEY_PATTERN,
} from './audit-sanitize.js';

describe('audit sanitizer', () => {
  it.each([
    'password',
    'newPassword',
    'currentPassword',
    'passwordHash',
    'pass',
    'secret',
    'mfaSecretEnc',
    'token',
    'accessToken',
    'refreshToken',
    'mfaToken',
    'authorization',
    'Authorization',
    'cookie',
    'apiKey',
    'api_key',
    'api-key',
    'otp',
    'otpCode',
    'pepper',
    'codeHash',
    'mfa',
    'mfaCode',
    'code',
    'otpauthUrl',
    'smsApiKey',
    'sessionToken',
    'jwt',
    'idJwt',
    'bearer',
    'signature',
    'privateKey',
    'private_key',
    'credentials',
    'pin',
    'pinCode',
  ])('treats %s as sensitive', (key) => {
    expect(SENSITIVE_KEY_PATTERN.test(key)).toBe(true);
  });

  it.each([
    'role',
    'status',
    'fullName',
    'phoneMasked',
    'protocolCode',
    'reason',
    'quantity',
    'shipping',
    'mapping',
    'opinion',
  ])('keeps %s', (key) => {
    expect(SENSITIVE_KEY_PATTERN.test(key)).toBe(false);
  });

  it('redacts recursively, inside arrays too', () => {
    expect(
      sanitizeValue({
        role: 'ADMIN',
        password: 'x',
        nested: { list: [{ token: 'y', ok: 1 }], deeper: { code: '123456' } },
      }),
    ).toStrictEqual({
      role: 'ADMIN',
      password: REDACTED,
      nested: {
        list: [{ token: REDACTED, ok: 1 }],
        deeper: { code: REDACTED },
      },
    });
  });

  it('caps depth, array length and string length', () => {
    let deep: Record<string, unknown> = { leaf: 'bottom' };
    for (let i = 0; i < 10; i += 1) deep = { child: deep };
    expect(JSON.stringify(sanitizeValue(deep))).toContain('[MAX_DEPTH]');
    expect(
      sanitizeValue(Array.from({ length: 120 }, (_, i) => i)),
    ).toHaveLength(50);
    const long = sanitizeValue('z'.repeat(5000)) as string;
    expect(long.length).toBe(501);
  });

  it('converts Decimal, Date, bigint and drops functions/symbols', () => {
    expect(
      sanitizeValue({
        amount: new Prisma.Decimal('10.50'),
        at: new Date('2026-01-02T03:04:05.000Z'),
        invalid: new Date('nope'),
        big: 2n ** 70n,
        fn: () => 1,
        sym: Symbol('s'),
        nan: Number.NaN,
        missing: undefined,
      }),
    ).toStrictEqual({
      amount: '10.5',
      at: '2026-01-02T03:04:05.000Z',
      invalid: null,
      big: '1180591620717411303424',
      nan: null,
    });
  });

  it('handles errors, buffers and cycles safely', () => {
    const cyclic: Record<string, unknown> = { name: 'a' };
    cyclic.self = cyclic;
    expect(sanitizeValue(cyclic)).toStrictEqual({
      name: 'a',
      self: '[CIRCULAR]',
    });
    expect(
      sanitizeValue({ err: new TypeError('contains secret') }),
    ).toStrictEqual({ err: { name: 'TypeError' } });
    expect(sanitizeValue({ file: Buffer.from('bytes') })).toStrictEqual({
      file: '[BINARY]',
    });
  });

  it('sanitizeAuditValue maps null/undefined to SQL NULL', () => {
    expect(sanitizeAuditValue(undefined)).toBeUndefined();
    expect(sanitizeAuditValue(null)).toBeUndefined();
    expect(sanitizeAuditValue({ a: 1 })).toStrictEqual({ a: 1 });
  });

  it('redacts JWT-shaped values and Bearer credentials under any key', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.c2lnbmF0dXJl';
    expect(
      sanitizeValue({
        note: jwt,
        header: 'Bearer abc.def-123',
        text: `failed for ${jwt} at login`,
        list: [jwt],
        phoneMasked: '+99890*****67',
      }),
    ).toStrictEqual({
      note: REDACTED,
      header: `Bearer ${REDACTED}`,
      text: `failed for ${REDACTED} at login`,
      list: [REDACTED],
      phoneMasked: '+99890*****67',
    });
  });

  it.each([
    ['audit', undefined],
    ['log', LOG_SANITIZE_OPTIONS],
  ])('%s mode walks class instances (DTOs, results)', (_mode, options) => {
    class MfaSetupResult {
      constructor(
        public otpauthUrl: string,
        public userId: string,
      ) {}
    }
    class Wrapper {
      constructor(public inner: Record<string, unknown>) {}
    }
    const out = sanitizeValue(
      {
        result: new MfaSetupResult('otpauth://totp/x?secret=JBSWY3DP', 'u1'),
        w: new Wrapper({
          refreshToken: 'RTSECRET',
          a: { b: { password: 'DEEPPW', smsApiKey: 'KEY1', ok: 1 } },
        }),
        url: new URL('https://example.test/a?b=1'),
      },
      options,
    );
    expect(out).toStrictEqual({
      result: { otpauthUrl: REDACTED, userId: 'u1' },
      w: {
        inner: {
          refreshToken: REDACTED,
          a: { b: { password: REDACTED, smsApiKey: REDACTED, ok: 1 } },
        },
      },
      url: 'https://example.test/a?b=1',
    });
  });

  it('log mode keeps only raw Node req/res objects for pino serializers', () => {
    const req = new IncomingMessage(new Socket());
    const res = new ServerResponse(req);
    const out = sanitizeValue(
      { req, res, token: 't' },
      LOG_SANITIZE_OPTIONS,
    ) as Record<string, unknown>;
    expect(out.req).toBe(req);
    expect(out.res).toBe(res);
    expect(out.token).toBe(REDACTED);
  });
});
