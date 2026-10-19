import { pino } from 'pino';
import { Prisma } from '../generated/prisma/client.js';
import {
  createLoggerOptions,
  REDACT_CENSOR,
  serializeError,
} from './logger.js';

function capture() {
  const lines: string[] = [];
  const logger = pino(createLoggerOptions('trace'), {
    write: (line: string) => void lines.push(line),
  });
  return {
    logger,
    lines,
    json: () =>
      lines.map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

describe('logger configuration', () => {
  it('writes JSON with a string level, ISO time and the service name', () => {
    const { logger, json } = capture();
    logger.info({ requestCount: 1 }, 'hello');
    expect(json()[0]).toMatchObject({
      level: 'info',
      service: 'meningfermam-api',
      requestCount: 1,
      msg: 'hello',
    });
    expect(Number.isNaN(Date.parse(String(json()[0].time)))).toBe(false);
  });

  it('redacts credentials in headers and sensitive keys up to depth 4', () => {
    const { logger, lines } = capture();
    logger.info(
      {
        req: {
          headers: {
            authorization: 'Bearer abc.def.ghi',
            cookie: 'mf_rt=zzz',
            'x-csrf-token': 'csrf',
          },
        },
        res: { headers: { 'set-cookie': 'mf_rt=new' } },
        body: {
          password: 'p1',
          a: { b: { refreshToken: 'r1', c: { otp: '123456' } } },
        },
        apiKey: 'k1',
        code: '654321',
      },
      'request',
    );
    const text = lines.join('');
    for (const secret of [
      'abc.def.ghi',
      'mf_rt=zzz',
      'csrf',
      'mf_rt=new',
      'p1',
      'r1',
      '123456',
      'k1',
      '654321',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain(REDACT_CENSOR);
  });

  it('summarizes errors, keeping only codes for database errors', () => {
    const dbError = new Prisma.PrismaClientKnownRequestError(
      'Invalid `prisma.user.create()` … Failing row contains (scrypt$hash)',
      {
        code: 'P2002',
        clientVersion: '7.10.1',
        meta: { modelName: 'User', target: 'detail-should-not-appear' },
      },
    );
    expect(serializeError(dbError)).toStrictEqual({
      type: 'PrismaClientKnownRequestError',
      prismaCode: 'P2002',
      model: 'User',
    });

    const plain = serializeError(new RangeError('bad range')) as Record<
      string,
      unknown
    >;
    expect(plain).toMatchObject({ type: 'RangeError', message: 'bad range' });
    expect(plain.stack).toContain('RangeError');
    expect(serializeError({ already: 'plain' })).toStrictEqual({
      already: 'plain',
    });

    const { logger, lines } = capture();
    logger.error({ err: dbError, nested: { dbError } }, 'db failed');
    logger.error(dbError);
    expect(lines.join('')).not.toMatch(
      /Failing row|scrypt\$|detail-should-not-appear|Invalid `/,
    );
  });

  it('keeps raw request objects away from redaction (serializers first)', () => {
    const { logger, json } = capture();
    const child = logger.child({
      req: {
        method: 'GET',
        url: '/api/v1/x?token=secret-q',
        headers: { authorization: 'Bearer t' },
      },
    });
    child.info('inside request');
    expect(json()[0].req).toStrictEqual({ method: 'GET', path: '/api/v1/x' });
  });
  it('redacts secrets inside class instances, JWTs and format arguments', () => {
    class MfaSetupResult {
      constructor(
        public otpauthUrl: string,
        public userId: string,
      ) {}
    }
    class Wrapper {
      constructor(public inner: Record<string, unknown>) {}
    }
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.JWTVALUEsig';
    const { logger, lines } = capture();
    logger.info(
      {
        result: new MfaSetupResult('otpauth://totp/x?secret=TOTPSECRET', 'u1'),
      },
      'mfa',
    );
    logger.info(
      { w: new Wrapper({ a: { b: { c: { password: 'DEEPPW' } } } }) },
      'deep',
    );
    logger.info({ jwt, note: jwt, signature: 'SIGVALUE' }, 'jwt');
    logger.info('token was %s, header %s', jwt, 'Bearer BEARERVALUE');
    logger.warn(new Error(`bad token ${jwt}`));
    const text = lines.join('');
    for (const secret of [
      'TOTPSECRET',
      'DEEPPW',
      'JWTVALUE',
      'SIGVALUE',
      'BEARERVALUE',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain('u1');
  });
});
