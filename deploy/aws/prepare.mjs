#!/usr/bin/env node
import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseArgs, parseEnv } from 'node:util';
import { pathToFileURL } from 'node:url';

// Compose env_file: format: raw. Quotes, dollar signs and # stay literal.
export function rawEnv(values) {
  return Object.entries(values)
    .map(([key, value]) => {
      if (!/^[A-Z][A-Z0-9_]*$/.test(key) || /[\r\n\0]/.test(String(value))) {
        throw new Error(`Invalid single-line environment field: ${key}`);
      }
      return `${key}=${value}\n`;
    })
    .join('');
}

export function prepare({
  domain,
  region = '',
  bucket = '',
  out,
  eskizEnv,
  tag,
}) {
  if (
    !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
      domain ?? '',
    )
  ) {
    throw new Error('--domain: enter a domain without https:// or a path');
  }
  if (region && !/^[a-z]{2}(?:-[a-z]+)+-\d$/.test(region))
    throw new Error('Invalid --region');
  if (bucket && !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket))
    throw new Error('Invalid --bucket');
  const release =
    tag ??
    new Date().toISOString().replace(/[-:]/g, '').slice(0, 15).toLowerCase();
  if (!/^[a-z0-9][a-z0-9_.-]{0,100}$/.test(release))
    throw new Error('Invalid --tag');
  const dir = resolve(out ?? '.deploy/aws');
  // An explicit allowlist imports only Eskiz settings, never dev DB/keys/demo.
  const source = eskizEnv ? parseEnv(readFileSync(eskizEnv, 'utf8')) : {};
  const eskiz = {};
  for (const key of [
    'ESKIZ_EMAIL',
    'ESKIZ_PASSWORD',
    'ESKIZ_FROM',
    'SMS_OTP_TEMPLATE',
  ]) {
    if (source[key]) eskiz[key] = source[key];
  }
  const secret = () => randomBytes(48).toString('hex');
  const admin = secret(),
    owner = secret(),
    app = secret(),
    backup = secret(),
    redis = secret();
  const databaseUrl = (role, password) =>
    `postgresql://${role}:${password}@postgres:5432/meningfermam?schema=public`;
  const api = {
    NODE_ENV: 'production',
    PORT: '3001',
    DATABASE_URL: databaseUrl('meningfermam_app', app),
    REDIS_URL: `redis://:${redis}@redis:6379/0`,
    TRUST_PROXY: '1',
    CORS_ORIGINS: `https://${domain}`,
    HTTPS_REQUIRED: 'true',
    AUTH_COOKIE_SECURE: 'true',
    AUTH_COOKIE_SAMESITE: 'strict',
    SWAGGER_ENABLED: 'false',
    LOG_LEVEL: 'info',
    LOG_PRETTY: 'false',
    JWT_ACCESS_SECRET: secret(),
    JWT_REFRESH_SECRET: secret(),
    OTP_HMAC_SECRET: secret(),
    DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    PASSWORD_SCRYPT_COST: '65536',
    SMS_PROVIDER: 'eskiz',
    SMS_ENABLED: 'true',
    SMS_MOCK_MODE: 'false',
    ESKIZ_EMAIL: '',
    ESKIZ_PASSWORD: '',
    ESKIZ_FROM: '4546',
    ESKIZ_BASE_URL: 'https://notify.eskiz.uz/api',
    SMS_OTP_TEMPLATE:
      'RIIZQ: Tasdiqlash kodingiz: {code}. Kod 5 daqiqa amal qiladi. Uni hech kimga bermang.',
    ...eskiz,
    OTP_LENGTH: '6',
    OTP_TTL_SECONDS: '300',
    OTP_MAX_ATTEMPTS: '5',
    OTP_RESEND_COOLDOWN_SECONDS: '60',
    OTP_MAX_REQUESTS_PER_HOUR: '5',
    SMS_DAILY_LIMIT_PER_PHONE: '10',
    SMS_DAILY_LIMIT_PER_IP: '50',
    STORAGE_DRIVER: 's3',
    S3_REGION: region,
    S3_BUCKET: bucket,
    S3_ACCESS_KEY_ID: '',
    S3_SECRET_ACCESS_KEY: '',
    S3_FORCE_PATH_STYLE: 'false',
    DEMO_ACCOUNTS_ENABLED: 'false',
    AWS_EC2_METADATA_V1_DISABLED: 'true',
  };
  // Validate all content before creating anything, including imported secrets.
  const files = {
    'compose.env': rawEnv({
      SITE_DOMAIN: domain,
      API_IMAGE: `riizq-api:${release}`,
      WEB_IMAGE: `riizq-web:${release}`,
    }),
    'api.env': rawEnv(api),
    'migrate.env': rawEnv({
      NODE_ENV: 'production',
      MIGRATION_DATABASE_URL: databaseUrl('meningfermam_owner', owner),
    }),
    'postgres.env': rawEnv({
      POSTGRES_USER: 'postgres',
      POSTGRES_DB: 'meningfermam',
      POSTGRES_PASSWORD: admin,
      POSTGRES_INITDB_ARGS: '--auth-host=scram-sha-256',
      OWNER_DB_PASSWORD: owner,
      APP_DB_PASSWORD: app,
      BACKUP_DB_PASSWORD: backup,
    }),
    'redis.env': rawEnv({ REDIS_PASSWORD: redis }),
  };
  mkdirSync(dirname(dir), { recursive: true, mode: 0o700 });
  // Deliberately refuses an existing directory: never rotate a live data key
  // or replace DB passwords while its volume still exists.
  mkdirSync(dir, { mode: 0o700 });
  for (const [name, data] of Object.entries(files))
    writeFileSync(join(dir, name), data, { mode: 0o600, flag: 'wx' });
  return {
    dir,
    missing: ['ESKIZ_EMAIL', 'ESKIZ_PASSWORD', 'S3_REGION', 'S3_BUCKET'].filter(
      (key) => !api[key],
    ),
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const { values } = parseArgs({
      options: {
        domain: { type: 'string' },
        region: { type: 'string' },
        bucket: { type: 'string' },
        out: { type: 'string' },
        'eskiz-env': { type: 'string' },
        tag: { type: 'string' },
      },
    });
    const result = prepare({ ...values, eskizEnv: values['eskiz-env'] });
    console.log(`Private deployment files created: ${result.dir}`);
    if (result.missing.length)
      console.log(
        `Complete in api.env before release: ${result.missing.join(', ')}`,
      );
    console.log(
      'Existing development .env files were not changed. Secrets were not printed.',
    );
  } catch (err) {
    // Do not echo file contents or credentials in parser/OS errors.
    console.error(
      err.code === 'EEXIST'
        ? 'Output directory exists; refusing to replace production secrets.'
        : 'Preparation failed. Check arguments, input file and output directory.',
    );
    process.exitCode = 1;
  }
}
