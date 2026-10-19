import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';
import { validateEnv } from '../../src/config/env.js';

// .env.example must document every variable of the env schema and be a
// working development configuration as-is.

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

const example = parse(read('../../.env.example'));
const schemaKeys = [
  ...read('../../src/config/env.ts').matchAll(/^ {4}([A-Z][A-Z0-9_]+):/gm),
].map((m) => m[1]);

describe('.env.example', () => {
  it('lists every variable of src/config/env.ts', () => {
    expect(schemaKeys.length).toBeGreaterThan(50);
    const missing = schemaKeys.filter((key) => !(key in example));
    expect(missing).toEqual([]);
  });

  it('documents the seed and migration variables too', () => {
    for (const key of [
      'MIGRATION_DATABASE_URL',
      'DEMO_SUPER_ADMIN_PHONE',
      'DEMO_SUPER_ADMIN_EMAIL',
      'DEMO_SUPER_ADMIN_PASSWORD',
      'DEMO_FARMER_PHONE',
      'DEMO_FARMER_EMAIL',
      'DEMO_FARMER_PASSWORD',
    ]) {
      expect(example).toHaveProperty(key);
    }
  });

  it('is a valid development configuration', () => {
    const env = validateEnv(example);
    expect(env.NODE_ENV).toBe('development');
    expect(env.MFA_ISSUER).toBe('Mening Fermam');
  });

  it('is rejected as-is in production (dev-only values cannot leak there)', () => {
    expect(() => validateEnv({ ...example, NODE_ENV: 'production' })).toThrow(
      /DEMO_ACCOUNTS_ENABLED[\s\S]*DEMO_PASSWORD|DEMO_PASSWORD[\s\S]*DEMO_ACCOUNTS_ENABLED/,
    );
  });

  it('marks every secret value as dev-only', () => {
    for (const key of [
      'JWT_ACCESS_SECRET',
      'JWT_REFRESH_SECRET',
      'OTP_PEPPER',
    ]) {
      expect(example[key]).toMatch(/^dev-only-/);
    }
    expect(
      Buffer.from(example.DATA_ENCRYPTION_KEY, 'base64').toString(),
    ).toMatch(/^dev-only-/);
  });
});
