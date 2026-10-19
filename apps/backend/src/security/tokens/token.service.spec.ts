import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { keyId } from '../crypto.js';
import { TokenService } from './token.service.js';

const env = {
  JWT_ACCESS_SECRET: 'unit-access-secret-0123456789abcdef0123',
  JWT_ACCESS_SECRETS_PREVIOUS: ['unit-old-access-secret-0123456789abcdef'],
  JWT_REFRESH_SECRET: 'unit-refresh-secret-0123456789abcdef012',
  JWT_REFRESH_SECRETS_PREVIOUS: [] as string[],
  JWT_ISSUER: 'unit-issuer',
  JWT_AUDIENCE: 'unit-audience',
  JWT_ACCESS_TTL_SECONDS: 900,
  MFA_TOKEN_TTL_SECONDS: 300,
};

function makeService(overrides: Partial<typeof env> = {}): TokenService {
  return new TokenService(
    new JwtService(),
    new ConfigService({ ...env, ...overrides }) as ConstructorParameters<
      typeof TokenService
    >[1],
  );
}

const decode = (token: string, part: 0 | 1) =>
  JSON.parse(
    Buffer.from(token.split('.')[part], 'base64url').toString(),
  ) as Record<string, unknown>;

describe('TokenService', () => {
  const tokens = makeService();
  const userId = randomUUID();
  const sessionId = randomUUID();

  it('signs access tokens with HS256, kid and only id claims', async () => {
    const { token, expiresIn } = await tokens.signAccess(userId, sessionId);
    expect(expiresIn).toBe(900);
    expect(decode(token, 0)).toStrictEqual({
      alg: 'HS256',
      typ: 'JWT',
      kid: keyId(env.JWT_ACCESS_SECRET),
    });
    const claims = await tokens.verifyAccess(token);
    expect(claims).toMatchObject({
      sub: userId,
      sid: sessionId,
      typ: 'access',
    });
    expect(Object.keys(decode(token, 1)).sort()).toEqual([
      'aud',
      'exp',
      'iat',
      'iss',
      'jti',
      'sid',
      'sub',
      'typ',
    ]);
  });

  it('pins refresh expiry to the family end and uses the refresh key ring', async () => {
    const notAfter = new Date(Date.now() + 3_600_000);
    const jti = randomUUID();
    const { token, expiresAt } = await tokens.signRefresh(
      userId,
      sessionId,
      jti,
      notAfter,
    );
    expect(expiresAt.getTime()).toBe(
      Math.floor(notAfter.getTime() / 1000) * 1000,
    );
    expect(decode(token, 0).kid).toBe(keyId(env.JWT_REFRESH_SECRET));
    await expect(tokens.verifyRefresh(token)).resolves.toMatchObject({
      jti,
      sid: sessionId,
      typ: 'refresh',
    });
    await expect(tokens.verifyAccess(token)).rejects.toMatchObject({
      status: 401,
    });
    await expect(
      tokens.signRefresh(userId, sessionId, jti, new Date(Date.now() - 1000)),
    ).rejects.toMatchObject({
      status: 401,
    });
  });

  it('issues MFA tokens that are not access tokens', async () => {
    const { token, jti, expiresIn } = await tokens.signMfa(userId, 'setup');
    expect(expiresIn).toBe(300);
    await expect(tokens.verifyMfa(token)).resolves.toMatchObject({
      sub: userId,
      typ: 'mfa',
      purpose: 'setup',
      jti,
    });
    await expect(tokens.verifyAccess(token)).rejects.toMatchObject({
      status: 401,
    });
    const { token: access } = await tokens.signAccess(userId, sessionId);
    await expect(tokens.verifyMfa(access)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('accepts tokens signed with a previous secret, rejects removed ones', async () => {
    const old = makeService({
      JWT_ACCESS_SECRET: env.JWT_ACCESS_SECRETS_PREVIOUS[0],
      JWT_ACCESS_SECRETS_PREVIOUS: [],
    });
    const { token } = await old.signAccess(userId, sessionId);
    await expect(tokens.verifyAccess(token)).resolves.toMatchObject({
      sub: userId,
    });
    const rotatedAway = makeService({ JWT_ACCESS_SECRETS_PREVIOUS: [] });
    await expect(rotatedAway.verifyAccess(token)).rejects.toMatchObject({
      status: 401,
    });
  });

  it('rejects other issuers/audiences and malformed input', async () => {
    const { token } = await makeService({ JWT_ISSUER: 'evil' }).signAccess(
      userId,
      sessionId,
    );
    await expect(tokens.verifyAccess(token)).rejects.toMatchObject({
      status: 401,
    });
    const { token: aud } = await makeService({
      JWT_AUDIENCE: 'evil',
    }).signAccess(userId, sessionId);
    await expect(tokens.verifyAccess(aud)).rejects.toMatchObject({
      status: 401,
    });
    for (const bad of [
      '',
      'a.b',
      'a.b.',
      'x'.repeat(5000),
      undefined as unknown as string,
    ]) {
      await expect(tokens.verifyAccess(bad)).rejects.toMatchObject({
        status: 401,
        code: 'UNAUTHORIZED',
      });
    }
  });
});
