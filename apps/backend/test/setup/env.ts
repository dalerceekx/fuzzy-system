import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resolveTestTargets } from './test-targets.js';

// Runs in every test worker before any test file is imported. The app
// ignores .env when NODE_ENV=test, and every app setting inherited from the
// shell (direnv, `set -a; . .env`) is dropped below, so this file is the
// whole environment: tests never reach real SMS, S3/MinIO or dev secrets.
// Individual tests opt into other values with createTestApp({ env }).

const targets = resolveTestTargets();

// Forced: tests must never reach a non-test database/Redis.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = targets.databaseUrl;
process.env.MIGRATION_DATABASE_URL = targets.databaseUrl;
process.env.REDIS_URL = targets.redisUrl;

const APP_SETTING =
  /^(PORT$|TRUST_PROXY|CORS_ORIGINS|HTTPS_REQUIRED|HSTS_|BODY_LIMIT|SWAGGER_|LOG_|RATE_LIMIT_|JWT_|MFA_|AUTH_COOKIE_|PASSWORD_|OTP_|DATA_ENCRYPTION_|LOGIN_|SMS_|ESKIZ_|STORAGE_DRIVER|S3_|UPLOAD_|IDEMPOTENCY_|DEMO_|OBSERVE_)/;
for (const name of Object.keys(process.env)) {
  if (APP_SETTING.test(name)) delete process.env[name];
}

const testKey = (fill: number) => Buffer.alloc(32, fill).toString('base64');

// Test-only values, never valid anywhere else. TEST_LOG_LEVEL (e.g. debug,
// with TEST_LOGS=stdout) is the one knob read from the shell.
const defaults: Record<string, string> = {
  TRUST_PROXY: 'loopback',
  CORS_ORIGINS: 'http://localhost:5173',
  HTTPS_REQUIRED: 'false',
  BODY_LIMIT: '100kb',
  SWAGGER_ENABLED: 'false',
  LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'info',
  LOG_PRETTY: 'false',
  // High so whole suites sharing 127.0.0.1 never trip it; the rate-limit
  // test lowers it for its own app instance.
  RATE_LIMIT_GLOBAL_PER_MINUTE: '100000',
  JWT_ISSUER: 'meningfermam-api',
  JWT_AUDIENCE: 'meningfermam-clients',
  JWT_ACCESS_SECRET: 'test-only-access-secret-0123456789abcdef',
  JWT_ACCESS_SECRETS_PREVIOUS: 'test-only-previous-access-secret-0123456789',
  JWT_REFRESH_SECRET: 'test-only-refresh-secret-0123456789abcdef',
  JWT_REFRESH_SECRETS_PREVIOUS: 'test-only-previous-refresh-secret-012345678',
  OTP_PEPPER: 'test-only-otp-pepper-0123456789abcdef0123',
  DATA_ENCRYPTION_KEY: testKey(1),
  DATA_ENCRYPTION_KEYS_PREVIOUS: testKey(2),
  PASSWORD_SCRYPT_COST: '1024',
  SMS_PROVIDER: 'mock',
  STORAGE_DRIVER: 'local',
  UPLOAD_LOCAL_DIR: join(
    tmpdir(),
    `meningfermam-uploads-${targets.databaseName}`,
  ),
  S3_BUCKET: 'meningfermam-test',
  DEMO_ACCOUNTS_ENABLED: 'false',
};

Object.assign(process.env, defaults);
