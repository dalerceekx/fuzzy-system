/**
 * Overrides that make the test environment pass production validation
 * (S3 behind a MinIO-style endpoint so no AWS call happens at startup).
 */
export const PRODUCTION_ENV: Record<string, string | undefined> = {
  NODE_ENV: 'production',
  HTTPS_REQUIRED: 'true',
  HSTS_MAX_AGE_SECONDS: '31536000',
  CORS_ORIGINS: 'https://admin.meningfermam.test',
  SMS_PROVIDER: 'http',
  SMS_API_URL: 'https://sms.meningfermam.test/send',
  SMS_API_KEY: 'test-only-sms-key',
  SMS_ALLOWED_HOSTS: 'sms.meningfermam.test',
  STORAGE_DRIVER: 's3',
  S3_ENDPOINT: 'http://127.0.0.1:9',
  S3_FORCE_PATH_STYLE: 'true',
  UPLOAD_LOCAL_DIR: undefined,
  PASSWORD_SCRYPT_COST: '32768',
  DEMO_ACCOUNTS_ENABLED: 'false',
};
