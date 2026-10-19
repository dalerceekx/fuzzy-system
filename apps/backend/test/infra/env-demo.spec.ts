import { validateEnv } from '../../src/config/env.js';

// REQUIREMENTS "DEMO XAVFSIZLIGI": DEMO_ACCOUNTS_ENABLED=true works only in
// development/test, and a production build has no demo password.

const key = (fill: number) => Buffer.alloc(32, fill).toString('base64');

const production: Record<string, string> = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://meningfermam_app:x@db.internal:5432/meningfermam',
  REDIS_URL: 'rediss://cache.internal:6379',
  TRUST_PROXY: '1',
  CORS_ORIGINS: 'https://app.meningfermam.uz',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
  OTP_PEPPER: 'c'.repeat(48),
  DATA_ENCRYPTION_KEY: key(7),
  SMS_PROVIDER: 'http',
  SMS_API_URL: 'https://sms.example.uz/v1/send',
  SMS_API_KEY: 'k'.repeat(32),
  SMS_ALLOWED_HOSTS: 'sms.example.uz',
  S3_BUCKET: 'meningfermam-private',
};

describe('validateEnv — demo settings', () => {
  it('accepts a production environment without demo settings', () => {
    const env = validateEnv(production);
    expect(env.DEMO_ACCOUNTS_ENABLED).toBe(false);
    expect(env.DEMO_PASSWORD).toBeUndefined();
  });

  it('rejects DEMO_ACCOUNTS_ENABLED=true in production', () => {
    expect(() =>
      validateEnv({ ...production, DEMO_ACCOUNTS_ENABLED: 'true' }),
    ).toThrow(/DEMO_ACCOUNTS_ENABLED/);
  });

  it('rejects any DEMO_PASSWORD in production', () => {
    expect(() =>
      validateEnv({ ...production, DEMO_PASSWORD: 'Some-demo-pass-123' }),
    ).toThrow(/DEMO_PASSWORD/);
  });

  it('treats an empty value as unset (DEMO_PASSWORD= in an env file)', () => {
    expect(() =>
      validateEnv({
        ...production,
        DEMO_PASSWORD: '',
        DEMO_ACCOUNTS_ENABLED: '',
      }),
    ).not.toThrow();
  });

  it.each(['development', 'test'])('allows demo accounts in %s', (nodeEnv) => {
    const env = validateEnv({
      ...production,
      NODE_ENV: nodeEnv,
      SMS_PROVIDER: 'mock',
      DEMO_ACCOUNTS_ENABLED: 'true',
      DEMO_PASSWORD: 'Demo-shared-pass-123',
    });
    expect(env.DEMO_ACCOUNTS_ENABLED).toBe(true);
  });
});
