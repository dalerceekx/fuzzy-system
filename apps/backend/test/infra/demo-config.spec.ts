import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DEMO_PHONE_PREFIX } from '../../src/common/phone.js';
import { UserRole } from '../../src/generated/prisma/enums.js';
import { resolveDemoConfig } from '../../prisma/demo/config.js';

const base = {
  DEMO_PASSWORD: 'Demo-shared-pass-123',
  DEMO_SUPER_ADMIN_PHONE: '+998900000001',
  DEMO_SUPER_ADMIN_EMAIL: 'Admin@MeningFermam.local',
  DEMO_SUPER_ADMIN_PASSWORD: 'DemoAdmin123!',
  DEMO_FARMER_PHONE: '+998 90 000 00 02',
  DEMO_FARMER_EMAIL: 'farmer@meningfermam.local',
  DEMO_FARMER_PASSWORD: 'DemoFarmer123!',
};

describe('resolveDemoConfig', () => {
  it('builds the env-driven accounts plus the reserved-range staff accounts', () => {
    const result = resolveDemoConfig(base);
    if (!result.ok) throw new Error(result.errors.join('; '));
    const byKey = Object.fromEntries(
      result.config.accounts.map((a) => [a.key, a]),
    );

    expect(byKey.SUPER_ADMIN).toMatchObject({
      role: UserRole.SUPER_ADMIN,
      phone: '+998900000001',
      email: 'admin@meningfermam.local',
      password: 'DemoAdmin123!',
    });
    expect(byKey.FARMER).toMatchObject({
      role: UserRole.FARMER,
      phone: '+998900000002',
      password: 'DemoFarmer123!',
    });
    for (const key of ['ADMIN', 'SUPPORT', 'VET', 'FARMER_2']) {
      expect(byKey[key].phone.startsWith(DEMO_PHONE_PREFIX)).toBe(true);
      expect(byKey[key].password).toBe(base.DEMO_PASSWORD);
    }
    expect(result.config.skipped).toEqual([]);
  });

  it('requires DEMO_PASSWORD — there is no default', () => {
    const { DEMO_PASSWORD: _omit, ...rest } = base;
    expect(resolveDemoConfig(rest)).toEqual({
      ok: false,
      errors: ['DEMO_PASSWORD berilmagan'],
    });
  });

  it('falls back to DEMO_PASSWORD and skips accounts whose phone is not set', () => {
    const result = resolveDemoConfig({
      DEMO_PASSWORD: base.DEMO_PASSWORD,
      DEMO_SUPER_ADMIN_PHONE: base.DEMO_SUPER_ADMIN_PHONE,
    });
    if (!result.ok) throw new Error(result.errors.join('; '));
    const superAdmin = result.config.accounts.find(
      (a) => a.key === 'SUPER_ADMIN',
    );
    expect(superAdmin?.password).toBe(base.DEMO_PASSWORD);
    expect(superAdmin?.email).toBeNull();
    expect(result.config.skipped).toEqual(['DEMO_FARMER_PHONE']);
  });

  it.each([
    [{ DEMO_PASSWORD: 'short-1' }, /DEMO_PASSWORD 12–128/],
    [{ DEMO_PASSWORD: 'no-digits-at-all' }, /harf va bitta raqam/],
    [{ DEMO_SUPER_ADMIN_PASSWORD: 'x900000001-long' }, /telefon raqamini/],
    [{ DEMO_FARMER_PHONE: '+1 202 555 0100' }, /DEMO_FARMER_PHONE noto‘g‘ri/],
    [{ DEMO_FARMER_EMAIL: 'not-an-email' }, /DEMO_FARMER_EMAIL noto‘g‘ri/],
    [
      { DEMO_FARMER_PHONE: '+998900000001' },
      /telefon raqamlari takrorlanmasin/,
    ],
    [
      { DEMO_FARMER_EMAIL: 'ADMIN@meningfermam.local' },
      /email manzillari takrorlanmasin/,
    ],
  ])('rejects %o', (override, error) => {
    const result = resolveDemoConfig({ ...base, ...override });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join('\n')).toMatch(error);
  });

  it('keeps demo credentials out of the seed source (env-driven only)', () => {
    const sources = [
      '../../prisma/seed.ts',
      '../../prisma/demo/config.ts',
      '../../prisma/demo/seed-demo.ts',
    ]
      .map((path) =>
        readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8'),
      )
      .join('\n');
    expect(sources).not.toMatch(
      /DemoAdmin123!|DemoFarmer123!|\+998900000001|\+998900000002/,
    );
    expect(sources).not.toMatch(/meningfermam\.local/);
  });
});
