import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import {
  MedicineStatus,
  ProtocolVersionStatus,
  UserRole,
  UserStatus,
} from '../../src/generated/prisma/enums.js';
import { verifyPassword } from '../../src/security/password.js';
import { DEMO_CLINICAL_LABEL, DEMO_PROTOCOL } from '../../prisma/demo/data.js';
import { demoStaffPhone } from '../../prisma/demo/config.js';
import { createUser, uniquePhone, uniqueSuffix } from '../utils/factories.js';
import { demoUsersFingerprint, runSeed } from './seed-runner.js';

const SHARED_PASSWORD = 'Demo-shared-pass-123';

describe('demo seed (development/test)', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function demoEnv(): Promise<Record<string, string>> {
    const suffix = uniqueSuffix();
    return {
      NODE_ENV: 'test',
      DEMO_ACCOUNTS_ENABLED: 'true',
      DEMO_PASSWORD: SHARED_PASSWORD,
      DEMO_SUPER_ADMIN_PHONE: await uniquePhone(),
      DEMO_SUPER_ADMIN_EMAIL: `Admin-${suffix}@MeningFermam.local`,
      DEMO_SUPER_ADMIN_PASSWORD: 'DemoAdmin123!',
      DEMO_FARMER_PHONE: await uniquePhone(),
      DEMO_FARMER_EMAIL: `farmer-${suffix}@meningfermam.local`,
      DEMO_FARMER_PASSWORD: 'DemoFarmer123!',
    };
  }

  it('skips with exit 0 and writes nothing unless DEMO_ACCOUNTS_ENABLED=true', async () => {
    for (const enabled of [undefined, 'false', '1', 'TRUE']) {
      const env = await demoEnv();
      if (enabled === undefined) delete env.DEMO_ACCOUNTS_ENABLED;
      else env.DEMO_ACCOUNTS_ENABLED = enabled;
      const before = await demoUsersFingerprint(prisma);

      const result = await runSeed(env);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('o‘tkazib yuborildi');
      expect(await demoUsersFingerprint(prisma)).toBe(before);
      expect(
        await prisma.user.count({
          where: {
            phone: { in: [env.DEMO_SUPER_ADMIN_PHONE, env.DEMO_FARMER_PHONE] },
          },
        }),
      ).toBe(0);
    }
  });

  it('refuses without DEMO_PASSWORD (no default password exists)', async () => {
    const env = await demoEnv();
    delete env.DEMO_PASSWORD;
    const before = await demoUsersFingerprint(prisma);

    const result = await runSeed(env);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('DEMO_PASSWORD berilmagan');
    expect(await demoUsersFingerprint(prisma)).toBe(before);
  });

  it('refuses weak or malformed settings before writing', async () => {
    const env: Record<string, string> = {
      ...(await demoEnv()),
      DEMO_PASSWORD: 'short1',
    };
    const before = await demoUsersFingerprint(prisma);
    const result = await runSeed(env);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toMatch(/DEMO_PASSWORD 12–128 belgi/);
    expect(result.stdout + result.stderr).not.toContain('short1');

    const badPhone = await runSeed({
      ...(await demoEnv()),
      DEMO_FARMER_PHONE: '+1 555 0100',
    });
    expect(badPhone.code).not.toBe(0);
    expect(badPhone.stderr).toContain('DEMO_FARMER_PHONE noto‘g‘ri');
    expect(await demoUsersFingerprint(prisma)).toBe(before);
  });

  it('creates isDemo accounts and DRAFT, clearly labelled clinical data; idempotent', async () => {
    const env = await demoEnv();

    const first = await runSeed(env);
    expect(first.stderr).toBe('');
    expect(first.code).toBe(0);
    // Passwords are never printed.
    for (const secret of [
      SHARED_PASSWORD,
      env.DEMO_SUPER_ADMIN_PASSWORD,
      env.DEMO_FARMER_PASSWORD,
    ]) {
      expect(first.stdout).not.toContain(secret);
    }

    const superAdmin = await prisma.user.findUniqueOrThrow({
      where: { phone: env.DEMO_SUPER_ADMIN_PHONE },
    });
    expect(superAdmin).toMatchObject({
      role: UserRole.SUPER_ADMIN,
      status: UserStatus.ACTIVE,
      isDemo: true,
      // Lower-cased for the DB's normalized-email check.
      email: env.DEMO_SUPER_ADMIN_EMAIL.toLowerCase(),
      // TOTP is enrolled at first login, never pre-seeded.
      mfaEnabled: false,
      mfaSecretEnc: null,
    });
    expect(superAdmin.phoneVerifiedAt).not.toBeNull();
    expect(
      await verifyPassword(
        env.DEMO_SUPER_ADMIN_PASSWORD,
        superAdmin.passwordHash,
      ),
    ).toBe(true);

    const farmer = await prisma.user.findUniqueOrThrow({
      where: { phone: env.DEMO_FARMER_PHONE },
      include: {
        farms: { include: { animals: true, inventoryItems: true } },
      },
    });
    expect(farmer).toMatchObject({ role: UserRole.FARMER, isDemo: true });
    expect(
      await verifyPassword(env.DEMO_FARMER_PASSWORD, farmer.passwordHash),
    ).toBe(true);
    expect(farmer.farms).toHaveLength(1);
    expect(farmer.farms[0].animals.length).toBeGreaterThan(0);
    for (const item of farmer.farms[0].inventoryItems) {
      const movements = await prisma.stockMovement.findMany({
        where: { itemId: item.id },
      });
      // Stock comes from the ledger: one IN movement matching the balance.
      expect(movements).toHaveLength(1);
      expect(movements[0].balanceAfter.toString()).toBe(
        item.quantity.toString(),
      );
      // A priced demo item got its price from that (priced) IN movement.
      expect(movements[0].unitCost?.toString() ?? null).toBe(
        item.unitPrice?.toString() ?? null,
      );
    }
    // Priced feeds for the feed warehouse and the ration calculator.
    const byName = new Map(
      farmer.farms[0].inventoryItems.map((item) => [item.name, item]),
    );
    for (const [name, quantity, unitPrice] of [
      ['Makkajo‘xori', '500.000', '3500.00'],
      ['Beda', '300.000', '2000.00'],
      ['Kepak', '200.000', '2800.00'],
      ['Somon', '400.000', '1000.00'],
      ['Arpa', '250.000', '3200.00'],
    ]) {
      const item = byName.get(name);
      expect(item).toMatchObject({ category: 'FEED', unit: 'KG' });
      expect(item?.quantity.toFixed(3)).toBe(quantity);
      expect(item?.unitPrice?.toFixed(2)).toBe(unitPrice);
      const [movement] = await prisma.stockMovement.findMany({
        where: { itemId: item?.id },
      });
      expect(movement).toMatchObject({ type: 'IN', currency: 'UZS' });
    }
    // The original demo items are still there (unpriced).
    expect(byName.get('Demo yem: bug‘doy kepagi')?.unitPrice).toBeNull();
    expect(byName.get('Demo jihoz: shprits 5 ml')).toBeDefined();

    // Staff demo accounts live in the reserved DEMO_PHONE_PREFIX range.
    const staff = await prisma.user.findMany({
      where: { phone: { in: [1, 2, 3, 4].map(demoStaffPhone) } },
    });
    expect(staff.map((u) => u.role).sort()).toEqual(
      [UserRole.ADMIN, UserRole.FARMER, UserRole.SUPPORT, UserRole.VET].sort(),
    );
    expect(staff.every((u) => u.isDemo)).toBe(true);
    const staffPassword = await verifyPassword(
      SHARED_PASSWORD,
      staff[0].passwordHash,
    );
    expect(staffPassword).toBe(true);

    // Clinical demo data: never APPROVED, always labelled.
    const protocol = await prisma.protocol.findUniqueOrThrow({
      where: { code: DEMO_PROTOCOL.code },
      include: {
        versions: { include: { drugs: { include: { medicine: true } } } },
      },
    });
    expect(protocol.isDemo).toBe(true);
    expect(protocol.versions.length).toBeGreaterThan(0);
    for (const version of protocol.versions) {
      expect(version.status).toBe(ProtocolVersionStatus.DRAFT);
      expect(version.approvedById).toBeNull();
      expect(version.title.startsWith(DEMO_CLINICAL_LABEL)).toBe(true);
      expect(version.instructions.startsWith(DEMO_CLINICAL_LABEL)).toBe(true);
      for (const drug of version.drugs) {
        expect(drug.medicine).toMatchObject({
          isDemo: true,
          status: MedicineStatus.DRAFT,
          approvedById: null,
        });
        expect(drug.medicine.name.startsWith(DEMO_CLINICAL_LABEL)).toBe(true);
      }
    }
    expect(
      await prisma.medicine.count({
        where: { isDemo: true, status: { not: MedicineStatus.DRAFT } },
      }),
    ).toBe(0);

    // Second run: same rows, no duplicates.
    const second = await runSeed(env);
    expect(second.code).toBe(0);
    const farmerAgain = await prisma.user.findUniqueOrThrow({
      where: { phone: env.DEMO_FARMER_PHONE },
      include: { farms: { include: { animals: true, inventoryItems: true } } },
    });
    expect(farmerAgain.id).toBe(farmer.id);
    expect(farmerAgain.farms).toHaveLength(1);
    expect(farmerAgain.farms[0].animals).toHaveLength(
      farmer.farms[0].animals.length,
    );
    expect(farmerAgain.farms[0].inventoryItems).toHaveLength(
      farmer.farms[0].inventoryItems.length,
    );
    expect(
      await prisma.protocol.count({ where: { code: DEMO_PROTOCOL.code } }),
    ).toBe(1);
  });

  it('never touches a real (non-demo) account and writes nothing when one is targeted', async () => {
    const { user: real } = await createUser(prisma, { role: UserRole.FARMER });
    const env: Record<string, string> = {
      ...(await demoEnv()),
      DEMO_FARMER_PHONE: real.phone,
    };
    const before = await demoUsersFingerprint(prisma);

    const result = await runSeed(env);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('demo bo‘lmagan akkauntga tegishli');
    const after = await prisma.user.findUniqueOrThrow({
      where: { id: real.id },
      include: { farms: true },
    });
    expect(after).toMatchObject({
      isDemo: false,
      passwordHash: real.passwordHash,
      fullName: real.fullName,
      updatedAt: real.updatedAt,
    });
    expect(after.farms).toEqual([]);
    // One transaction: the SUPER_ADMIN configured alongside was not created.
    expect(
      await prisma.user.findUnique({
        where: { phone: env.DEMO_SUPER_ADMIN_PHONE },
      }),
    ).toBeNull();
    expect(await demoUsersFingerprint(prisma)).toBe(before);
  });

  it('never changes the role of an existing demo account and says how to recover', async () => {
    const first = await demoEnv();
    expect((await runSeed(first)).code).toBe(0);
    // The FARMER login now points at the demo SUPER_ADMIN created above.
    const env: Record<string, string> = {
      ...(await demoEnv()),
      DEMO_FARMER_PHONE: first.DEMO_SUPER_ADMIN_PHONE,
    };
    const before = await demoUsersFingerprint(prisma);

    const result = await runSeed(env);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('mavjud akkaunt roli o‘zgartirilmaydi');
    expect(result.stderr).toContain('npm run dev:reset');
    expect(
      await prisma.user.findUniqueOrThrow({
        where: { phone: first.DEMO_SUPER_ADMIN_PHONE },
      }),
    ).toMatchObject({ role: UserRole.SUPER_ADMIN, isDemo: true });
    // One transaction: the SUPER_ADMIN configured alongside was not created.
    expect(
      await prisma.user.findUnique({
        where: { phone: env.DEMO_SUPER_ADMIN_PHONE },
      }),
    ).toBeNull();
    expect(await demoUsersFingerprint(prisma)).toBe(before);
  });

  it('refuses an email that belongs to a real account', async () => {
    const { user: real } = await createUser(prisma, { role: UserRole.VET });
    const email = `real-${uniqueSuffix()}@example.uz`;
    await prisma.user.update({ where: { id: real.id }, data: { email } });
    const env: Record<string, string> = {
      ...(await demoEnv()),
      DEMO_SUPER_ADMIN_EMAIL: email,
    };

    const result = await runSeed(env);

    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain('email boshqa akkauntga tegishli');
    expect(
      await prisma.user.findUnique({
        where: { phone: env.DEMO_SUPER_ADMIN_PHONE },
      }),
    ).toBeNull();
  });
});
