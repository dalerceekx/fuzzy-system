import { validateEnv } from '../config/env.js';

/** Offline validation only: never starts Nest, connects to AWS or sends SMS. */
const failures = new Set<string>();
const raw = process.env;
try {
  const env = validateEnv(raw);
  if (env.NODE_ENV !== 'production') failures.add('NODE_ENV');
  if (env.TRUST_PROXY !== '1') failures.add('TRUST_PROXY');
  if (env.CORS_ORIGINS.join(',') !== `https://${raw.SITE_DOMAIN}`)
    failures.add('CORS_ORIGINS / SITE_DOMAIN');
  if (env.AUTH_COOKIE_DOMAIN) failures.add('AUTH_COOKIE_DOMAIN');
  if (env.SWAGGER_ENABLED) failures.add('SWAGGER_ENABLED');
  if (env.S3_ENDPOINT) failures.add('S3_ENDPOINT (AWS: unset)');
  if (env.S3_FORCE_PATH_STYLE) failures.add('S3_FORCE_PATH_STYLE');
  if (!raw.S3_REGION) failures.add('S3_REGION');
  if (Boolean(env.S3_ACCESS_KEY_ID) !== Boolean(env.S3_SECRET_ACCESS_KEY))
    failures.add('S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY');
  if (env.SMS_PROVIDER !== 'eskiz') failures.add('SMS_PROVIDER');
  const db = new URL(env.DATABASE_URL);
  if (
    !['postgres:', 'postgresql:'].includes(db.protocol) ||
    db.username !== 'meningfermam_app' ||
    db.hostname !== 'postgres' ||
    !db.password
  )
    failures.add('DATABASE_URL (runtime role)');
  const redis = new URL(env.REDIS_URL);
  if (
    redis.protocol !== 'redis:' ||
    redis.hostname !== 'redis' ||
    !redis.password
  )
    failures.add('REDIS_URL');
} catch {
  // Zod/errors may contain user-supplied text. Never print raw environment.
  failures.add('api.env schema (required fields, secrets, production flags)');
}
for (const key of ['S3_BUCKET', 'S3_REGION', 'ESKIZ_EMAIL', 'ESKIZ_PASSWORD']) {
  if (!raw[key] || /^(CHANGE|REPLACE|TODO|your[-_])/i.test(raw[key] ?? ''))
    failures.add(key);
}
if (
  Object.keys(raw).some(
    (key) =>
      key.startsWith('DEMO_') && key !== 'DEMO_ACCOUNTS_ENABLED' && raw[key],
  )
)
  failures.add('DEMO_*');
if (raw.MIGRATION_DATABASE_URL)
  failures.add('MIGRATION_DATABASE_URL must not be in API');
if (!/^(?:[a-z0-9-]+\.)+[a-z]{2,63}$/.test(raw.SITE_DOMAIN ?? ''))
  failures.add('SITE_DOMAIN');

if (failures.size) {
  process.stderr.write(
    `Production preflight failed: ${[...failures].join('; ')}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    'Production configuration OK (offline). AWS access, DNS and SMS delivery still need live verification.\n',
  );
}
