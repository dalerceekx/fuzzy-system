import { isAbsolute } from 'node:path';
import { z } from 'zod';

// Comma-separated list → trimmed, non-empty items.
const csv = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
  );

const secret = (min = 32) => z.string().min(min);

// 32 random bytes, base64-encoded (`openssl rand -base64 32`).
const aes256Key = z
  .string()
  .refine((value) => Buffer.from(value, 'base64').length === 32, {
    message: '32 baytli base64 kalit bo‘lsin (openssl rand -base64 32)',
  });

const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3001),

    // --- Database / cache -------------------------------------------------
    // Runtime (least-privilege) connection. Migrations may use
    // MIGRATION_DATABASE_URL (read by prisma.config.ts only).
    DATABASE_URL: z.url(),
    REDIS_URL: z.url(),

    // --- HTTP -----------------------------------------------------------
    // Express `trust proxy`: `false`, hop count (`1`), `loopback`, or a
    // comma-separated list of proxy IPs/CIDRs. `true` (trust everyone) is
    // rejected because it lets clients spoof their IP via X-Forwarded-For.
    TRUST_PROXY: z.string().default('false'),
    // Exact origins only, e.g. `https://admin.meningfermam.uz`. Never `*`.
    CORS_ORIGINS: csv,
    // Reject plain-HTTP requests (as seen through the trusted proxy).
    // Defaults to true in production.
    HTTPS_REQUIRED: z.stringbool().optional(),
    HSTS_MAX_AGE_SECONDS: z.coerce.number().int().min(0).default(31_536_000),
    BODY_LIMIT: z
      .string()
      .regex(/^\d+(kb|mb)$/, 'Masalan: 100kb yoki 1mb')
      .default('100kb'),
    SWAGGER_ENABLED: z.stringbool().default(false),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    LOG_PRETTY: z.stringbool().default(false),
    RATE_LIMIT_GLOBAL_PER_MINUTE: z.coerce
      .number()
      .int()
      .positive()
      .default(300),

    // --- JWT --------------------------------------------------------------
    JWT_ISSUER: z.string().min(1).default('meningfermam-api'),
    JWT_AUDIENCE: z.string().min(1).default('meningfermam-clients'),
    // Separate secrets for access and refresh tokens. The *_PREVIOUS lists
    // are accepted for verification only, which allows rotation without
    // logging everyone out: deploy the new secret, move the old one into
    // *_PREVIOUS, remove it after the token lifetime has passed.
    JWT_ACCESS_SECRET: secret(),
    JWT_ACCESS_SECRETS_PREVIOUS: csv,
    JWT_REFRESH_SECRET: secret(),
    JWT_REFRESH_SECRETS_PREVIOUS: csv,
    JWT_ACCESS_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(3600)
      .default(900),
    JWT_REFRESH_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(3600)
      .max(90 * 24 * 3600)
      .default(30 * 24 * 3600),
    MFA_TOKEN_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(60)
      .max(900)
      .default(300),

    // --- Refresh-token cookie (web clients) -------------------------------
    AUTH_COOKIE_SECURE: z.stringbool().default(true),
    AUTH_COOKIE_DOMAIN: z.string().optional(),
    AUTH_COOKIE_SAMESITE: z.enum(['strict', 'lax']).default('strict'),

    // --- Credentials & codes ---------------------------------------------
    // scrypt N parameter (power of two). Production minimum is 2^15.
    PASSWORD_SCRYPT_COST: z.coerce
      .number()
      .int()
      .refine((n) => n >= 1024 && (n & (n - 1)) === 0, {
        message: '2 ning darajasi bo‘lsin (masalan 65536)',
      })
      .default(65_536),
    // HMAC key for OTP digests: a leaked database alone cannot be used to
    // brute-force the 6-digit codes offline.
    OTP_PEPPER: secret(),
    OTP_HMAC_SECRET: secret().optional(),
    OTP_LENGTH: z.coerce.number().int().min(6).max(6).default(6),
    OTP_EXPIRES_IN: z.coerce.number().int().min(60).max(900).optional(),
    OTP_RESEND_COOLDOWN: z.coerce.number().int().min(10).optional(),
    OTP_TTL_SECONDS: z.coerce.number().int().min(60).max(900).default(300),
    OTP_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),
    OTP_RESEND_COOLDOWN_SECONDS: z.coerce.number().int().min(10).default(60),
    OTP_MAX_SENDS: z.coerce.number().int().min(1).max(10).default(5),
    OTP_MAX_REQUESTS_PER_HOUR: z.coerce
      .number()
      .int()
      .min(1)
      .max(20)
      .default(5),
    // AES-256-GCM key for data encrypted at rest (TOTP secrets, queued SMS
    // payloads). *_PREVIOUS keys are used for decryption only (rotation).
    DATA_ENCRYPTION_KEY: aes256Key,
    DATA_ENCRYPTION_KEYS_PREVIOUS: csv.pipe(z.array(aes256Key)),
    MFA_ISSUER: z.string().min(1).default('Mening Fermam'),

    // --- Brute-force protection --------------------------------------------
    LOGIN_RATE_LIMIT_PER_IP: z.coerce.number().int().positive().default(20),
    LOGIN_RATE_LIMIT_WINDOW_SECONDS: z.coerce
      .number()
      .int()
      .positive()
      .default(900),
    LOGIN_MAX_FAILED_ATTEMPTS: z.coerce.number().int().positive().default(5),
    LOGIN_LOCKOUT_SECONDS: z.coerce.number().int().positive().default(900),
    MFA_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(5),

    // --- SMS --------------------------------------------------------------
    SMS_PROVIDER: z.enum(['mock', 'http', 'eskiz']).default('mock'),
    SMS_ENABLED: z.stringbool().default(true),
    SMS_MOCK_MODE: z.stringbool().default(false),
    ESKIZ_EMAIL: z.email().optional(),
    ESKIZ_PASSWORD: z.string().min(1).optional(),
    ESKIZ_BASE_URL: z.url().default('https://notify.eskiz.uz/api'),
    ESKIZ_FROM: z
      .string()
      .regex(/^[A-Za-z0-9]{1,11}$/)
      .default('4546'),
    SMS_OTP_TEMPLATE: z
      .string()
      .min(1)
      .max(500)
      .refine(
        (value) => value.includes('{code}'),
        'SMS shablonida {code} bo‘lishi shart',
      )
      .default(
        'RIIZQ: Tasdiqlash kodingiz: {code}. Kod 5 daqiqa amal qiladi. Uni hech kimga bermang.',
      ),
    SMS_API_URL: z.url().optional(),
    // Read from the environment / secret manager only; never logged.
    SMS_API_KEY: z.string().min(1).optional(),
    SMS_SENDER: z.string().max(11).optional(),
    // Hostnames the HTTP provider may call (exact match).
    SMS_ALLOWED_HOSTS: csv,
    // HMAC-SHA256 secret for delivery-report webhooks; webhook is disabled
    // while unset.
    SMS_WEBHOOK_SECRET: secret().optional(),
    SMS_DAILY_LIMIT_PER_PHONE: z.coerce.number().int().positive().default(10),
    SMS_DAILY_LIMIT_PER_IP: z.coerce.number().int().positive().default(50),
    SMS_MAX_SEND_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),

    // --- File storage -------------------------------------------------------
    // `s3` (private bucket) in production; `local` for development/tests.
    STORAGE_DRIVER: z.enum(['s3', 'local']).default('s3'),
    // Leave S3_ENDPOINT empty on AWS; set it for MinIO in development.
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().default('us-east-1'),
    S3_BUCKET: z.string().min(1),
    // Optional so production can rely on the instance/task IAM role.
    S3_ACCESS_KEY_ID: z.string().optional(),
    S3_SECRET_ACCESS_KEY: z.string().optional(),
    S3_FORCE_PATH_STYLE: z.stringbool().default(false),
    S3_SIGNED_URL_TTL_SECONDS: z.coerce
      .number()
      .int()
      .min(10)
      .max(3600)
      .default(300),
    // Absolute path outside the project directory (checked at startup).
    UPLOAD_LOCAL_DIR: z.string().optional(),
    UPLOAD_MAX_FILE_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .max(50 * 1024 * 1024)
      .default(10 * 1024 * 1024),
    UPLOAD_MAX_FILES_PER_USER: z.coerce.number().int().positive().default(500),
    UPLOAD_USER_QUOTA_BYTES: z.coerce
      .number()
      .int()
      .positive()
      .default(200 * 1024 * 1024),
    UPLOAD_STRIP_METADATA: z.stringbool().default(true),

    // --- Idempotency ----------------------------------------------------------
    IDEMPOTENCY_TTL_SECONDS: z.coerce.number().int().min(60).default(86_400),

    // --- Demo -----------------------------------------------------------------
    // Demo accounts may exist (and log in) only in development and test.
    DEMO_ACCOUNTS_ENABLED: z.stringbool().default(false),
    // Seed-only; there is deliberately no default password.
    DEMO_PASSWORD: z.string().min(12).optional(),

    // --- Telemetry ------------------------------------------------------------
    OBSERVE_APP_KEY: z.string().optional(),
    OBSERVE_APP_SECRET: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    const fail = (path: string, message: string) =>
      ctx.addIssue({ code: 'custom', path: [path], message });
    const production = env.NODE_ENV === 'production';

    if (env.TRUST_PROXY === 'true') {
      fail(
        'TRUST_PROXY',
        '`true` ishlatilmaydi: hop soni, loopback yoki IP/CIDR ro‘yxatini bering',
      );
    }
    if (env.CORS_ORIGINS.some((origin) => origin.includes('*'))) {
      fail('CORS_ORIGINS', 'Wildcard (*) ruxsat etilmaydi');
    }
    for (const origin of env.CORS_ORIGINS) {
      let parsed: URL | undefined;
      try {
        parsed = new URL(origin);
      } catch {
        parsed = undefined;
      }
      if (!parsed || parsed.origin !== origin) {
        fail(
          'CORS_ORIGINS',
          `Noto‘g‘ri origin: ${origin} (masalan https://admin.example.uz)`,
        );
      } else if (production && parsed.protocol !== 'https:') {
        fail('CORS_ORIGINS', `Production’da faqat https origin: ${origin}`);
      }
    }

    const secrets = [
      env.JWT_ACCESS_SECRET,
      env.JWT_REFRESH_SECRET,
      env.OTP_PEPPER,
    ];
    if (new Set(secrets).size !== secrets.length) {
      fail(
        'JWT_REFRESH_SECRET',
        'JWT_ACCESS_SECRET, JWT_REFRESH_SECRET va OTP_PEPPER har xil bo‘lsin',
      );
    }
    for (const [name, list] of [
      ['JWT_ACCESS_SECRETS_PREVIOUS', env.JWT_ACCESS_SECRETS_PREVIOUS],
      ['JWT_REFRESH_SECRETS_PREVIOUS', env.JWT_REFRESH_SECRETS_PREVIOUS],
    ] as const) {
      if (list.some((value) => value.length < 32)) {
        fail(name, 'Har bir eski secret kamida 32 belgi bo‘lsin');
      }
    }

    const liveSms = env.SMS_ENABLED && !env.SMS_MOCK_MODE;
    if (env.SMS_PROVIDER === 'eskiz') {
      const url = new URL(env.ESKIZ_BASE_URL);
      if (
        url.protocol !== 'https:' ||
        url.hostname !== 'notify.eskiz.uz' ||
        (url.port !== '' && url.port !== '443') ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.pathname.replace(/\/$/, '') !== '/api'
      ) {
        fail(
          'ESKIZ_BASE_URL',
          'Faqat rasmiy https://notify.eskiz.uz/api manzili',
        );
      }
      if (liveSms && !env.ESKIZ_EMAIL)
        fail('ESKIZ_EMAIL', 'SMS_PROVIDER=eskiz uchun majburiy');
      if (liveSms && !env.ESKIZ_PASSWORD)
        fail('ESKIZ_PASSWORD', 'SMS_PROVIDER=eskiz uchun majburiy');
    }

    if (env.SMS_PROVIDER === 'http' && liveSms) {
      if (!env.SMS_API_URL)
        fail('SMS_API_URL', 'SMS_PROVIDER=http uchun majburiy');
      if (!env.SMS_API_KEY)
        fail('SMS_API_KEY', 'SMS_PROVIDER=http uchun majburiy');
      if (env.SMS_API_URL) {
        const url = new URL(env.SMS_API_URL);
        if (url.protocol !== 'https:') fail('SMS_API_URL', 'Faqat https');
        if (!env.SMS_ALLOWED_HOSTS.includes(url.hostname)) {
          fail('SMS_ALLOWED_HOSTS', `${url.hostname} allowlist’da yo‘q`);
        }
      }
    }

    if (env.STORAGE_DRIVER === 'local') {
      if (!env.UPLOAD_LOCAL_DIR || !isAbsolute(env.UPLOAD_LOCAL_DIR)) {
        fail(
          'UPLOAD_LOCAL_DIR',
          'STORAGE_DRIVER=local uchun absolute yo‘l majburiy',
        );
      }
    }

    if (production) {
      // Public development examples must never become production signing or
      // encryption keys, including keys retained for rotation.
      for (const [name, values] of [
        ['JWT_ACCESS_SECRET', [env.JWT_ACCESS_SECRET]],
        ['JWT_REFRESH_SECRET', [env.JWT_REFRESH_SECRET]],
        ['OTP_PEPPER', [env.OTP_PEPPER]],
        ['JWT_ACCESS_SECRETS_PREVIOUS', env.JWT_ACCESS_SECRETS_PREVIOUS],
        ['JWT_REFRESH_SECRETS_PREVIOUS', env.JWT_REFRESH_SECRETS_PREVIOUS],
      ] as const) {
        if (values.some((value) => value.startsWith('dev-only-')))
          fail(name, 'Development namunaviy kaliti production’da taqiqlangan');
      }
      for (const key of [
        env.DATA_ENCRYPTION_KEY,
        ...env.DATA_ENCRYPTION_KEYS_PREVIOUS,
      ]) {
        if (Buffer.from(key, 'base64').toString('utf8').startsWith('dev-only-'))
          fail(
            'DATA_ENCRYPTION_KEY',
            'Development shifrlash kaliti production’da taqiqlangan',
          );
      }
      if (!env.SMS_ENABLED)
        fail('SMS_ENABLED', 'Production muhitida SMS yoqilgan bo‘lsin');
      if (env.SMS_MOCK_MODE)
        fail('SMS_MOCK_MODE', 'Production muhitida mock SMS taqiqlangan');
      if (env.SMS_PROVIDER === 'mock') {
        fail('SMS_PROVIDER', 'Production muhitida mock SMS ishlatib bo‘lmaydi');
      }
      if (env.DEMO_ACCOUNTS_ENABLED) {
        fail(
          'DEMO_ACCOUNTS_ENABLED',
          'Production muhitida demo akkauntlar taqiqlangan',
        );
      }
      if (env.DEMO_PASSWORD) {
        fail(
          'DEMO_PASSWORD',
          'Production muhitida demo parol bo‘lmasligi kerak',
        );
      }
      if (env.STORAGE_DRIVER !== 's3') {
        fail(
          'STORAGE_DRIVER',
          'Production’da fayllar faqat private object storage’da (s3)',
        );
      }
      if (!env.AUTH_COOKIE_SECURE) {
        fail('AUTH_COOKIE_SECURE', 'Production’da cookie faqat Secure');
      }
      if (env.HTTPS_REQUIRED === false) {
        fail('HTTPS_REQUIRED', 'Production faqat HTTPS orqali ishlaydi');
      }
      if (env.LOG_PRETTY)
        fail('LOG_PRETTY', 'Production’da loglar JSON formatida');
      if (env.PASSWORD_SCRYPT_COST < 32_768) {
        fail('PASSWORD_SCRYPT_COST', 'Production’da kamida 32768');
      }
    }
  })
  .transform((env) => ({
    ...env,
    HTTPS_REQUIRED: env.HTTPS_REQUIRED ?? env.NODE_ENV === 'production',
  }));

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  // Treat empty strings from .env files as unset.
  const cleaned = Object.fromEntries(
    Object.entries(raw).filter(([, value]) => value !== ''),
  );
  // Requested names and established deployment names are aliases. Refuse
  // conflicting values instead of silently choosing a different secret/TTL.
  for (const [alias, canonical] of [
    ['OTP_HMAC_SECRET', 'OTP_PEPPER'],
    ['OTP_EXPIRES_IN', 'OTP_TTL_SECONDS'],
    ['OTP_RESEND_COOLDOWN', 'OTP_RESEND_COOLDOWN_SECONDS'],
  ] as const) {
    if (cleaned[alias] !== undefined) {
      if (
        cleaned[canonical] !== undefined &&
        String(cleaned[canonical]) !== String(cleaned[alias])
      ) {
        throw new Error(
          `Environment xato: ${alias} va ${canonical} bir xil bo‘lishi kerak`,
        );
      }
      cleaned[canonical] = cleaned[alias];
    }
  }
  const result = envSchema.safeParse(cleaned);
  if (!result.success) {
    throw new Error(`Environment xato:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}
