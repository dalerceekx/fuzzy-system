import { validateEnv } from './env.js';

const production = {
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://app:password@localhost:5432/app',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(48),
  JWT_REFRESH_SECRET: 'b'.repeat(48),
  OTP_HMAC_SECRET: 'c'.repeat(48),
  DATA_ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
  S3_BUCKET: 'private-test-bucket',
  SMS_PROVIDER: 'eskiz',
  SMS_ENABLED: 'true',
  SMS_MOCK_MODE: 'false',
  ESKIZ_EMAIL: 'account@example.test',
  ESKIZ_PASSWORD: 'test-only-password',
};

describe('Eskiz and OTP environment validation', () => {
  it.each([
    { JWT_ACCESS_SECRET: 'dev-only-access-secret-change-me-0123456789abcdef' },
    { OTP_HMAC_SECRET: 'dev-only-otp-pepper-change-me-0123456789abcdef' },
    {
      JWT_REFRESH_SECRETS_PREVIOUS:
        'dev-only-refresh-secret-change-me-0123456789abcdef',
    },
    { DATA_ENCRYPTION_KEY: 'ZGV2LW9ubHktZGF0YS1lbmNyeXB0aW9uLWtleS0zMmI=' },
    {
      DATA_ENCRYPTION_KEYS_PREVIOUS:
        'ZGV2LW9ubHktZGF0YS1lbmNyeXB0aW9uLWtleS0zMmI=',
    },
  ])('rejects development example keys in production', (override) => {
    expect(() => validateEnv({ ...production, ...override })).toThrow(
      /Development/,
    );
  });

  it('accepts real-provider production config and maps supported OTP aliases', () => {
    const env = validateEnv({
      ...production,
      OTP_EXPIRES_IN: '300',
      OTP_RESEND_COOLDOWN: '60',
    });
    expect(env).toMatchObject({
      SMS_PROVIDER: 'eskiz',
      ESKIZ_FROM: '4546',
      OTP_LENGTH: 6,
      OTP_PEPPER: production.OTP_HMAC_SECRET,
      OTP_TTL_SECONDS: 300,
      OTP_RESEND_COOLDOWN_SECONDS: 60,
      OTP_MAX_REQUESTS_PER_HOUR: 5,
    });
    expect(env.SMS_OTP_TEMPLATE).toContain('{code}');
  });

  it.each(['ESKIZ_EMAIL', 'ESKIZ_PASSWORD', 'OTP_HMAC_SECRET'])(
    'rejects production missing %s',
    (field) => {
      expect(() => validateEnv({ ...production, [field]: undefined })).toThrow(
        /Environment xato/,
      );
    },
  );

  it.each([
    { SMS_PROVIDER: 'mock' },
    { SMS_MOCK_MODE: 'true' },
    { SMS_ENABLED: 'false' },
  ])('rejects disabled/mock production SMS %j', (override) => {
    expect(() => validateEnv({ ...production, ...override })).toThrow(/SMS_/);
  });

  it('allows explicit safe mock mode without credentials in development', () => {
    expect(
      validateEnv({
        ...production,
        NODE_ENV: 'development',
        SMS_MOCK_MODE: 'true',
        ESKIZ_EMAIL: undefined,
        ESKIZ_PASSWORD: undefined,
      }).SMS_MOCK_MODE,
    ).toBe(true);
  });

  it.each([
    { OTP_PEPPER: 'd'.repeat(48) },
    { OTP_EXPIRES_IN: '300', OTP_TTL_SECONDS: '900' },
    { OTP_RESEND_COOLDOWN: '60', OTP_RESEND_COOLDOWN_SECONDS: '120' },
  ])('rejects conflicting old/new OTP settings %j', (override) => {
    expect(() => validateEnv({ ...production, ...override })).toThrow(
      /bir xil/,
    );
  });

  it.each([
    { OTP_LENGTH: '4' },
    { ESKIZ_EMAIL: 'invalid' },
    { ESKIZ_BASE_URL: 'http://notify.eskiz.uz/api' },
    { ESKIZ_BASE_URL: 'https://evil.test/api' },
    { ESKIZ_BASE_URL: 'https://notify.eskiz.uz/api?key=secret' },
    { SMS_OTP_TEMPLATE: 'Code missing' },
    { OTP_MAX_REQUESTS_PER_HOUR: '0' },
  ])('rejects unsafe/invalid configuration %j', (override) => {
    expect(() => validateEnv({ ...production, ...override })).toThrow(
      /Environment xato/,
    );
  });
});
