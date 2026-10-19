import type {
  Prisma,
  PrismaClient,
  User,
} from '../../src/generated/prisma/client.js';
import {
  SessionRevokeReason,
  StockMovementType,
  UserRole,
  UserStatus,
} from '../../src/generated/prisma/enums.js';
import { hashPassword, verifyPassword } from '../../src/security/password.js';
import type { DemoAccount, DemoConfig } from './config.js';
import {
  DEMO_ANIMALS,
  DEMO_FARM,
  DEMO_INVENTORY,
  DEMO_MEDICINES,
  DEMO_PROTOCOL,
} from './data.js';

type Tx = Prisma.TransactionClient;

/** A refusal with a message that is safe to print (no secrets, no rows). */
export class DemoSeedError extends Error {}

export interface SeedDemoOptions {
  scryptCost: number;
  log: (message: string) => void;
}

/**
 * Writes the demo accounts and demo farm/clinical data in ONE transaction:
 * any refusal (e.g. a configured phone or email that belongs to a real
 * account) leaves the database untouched. Idempotent: existing demo rows
 * are reused, never duplicated.
 */
export async function seedDemo(
  prisma: PrismaClient,
  config: DemoConfig,
  options: SeedDemoOptions,
): Promise<void> {
  // Hashing is slow; do it before the transaction opens.
  const hashes = new Map<string, string>();
  for (const account of config.accounts) {
    hashes.set(
      account.key,
      await hashPassword(account.password, options.scryptCost),
    );
  }

  const users = await prisma.$transaction(
    async (tx) => {
      const ready = new Map<string, User>();
      for (const account of config.accounts) {
        ready.set(
          account.key,
          await upsertDemoUser(tx, account, hashes.get(account.key)!),
        );
      }

      const vet = [...ready.values()].find((u) => u.role === UserRole.VET);
      if (!vet) throw new DemoSeedError('Demo VET akkaunti topilmadi');
      for (const user of ready.values()) {
        if (user.role === UserRole.FARMER) await ensureFarm(tx, user);
      }
      await ensureClinicalDrafts(tx, vet);
      return [...ready.values()];
    },
    { timeout: 60_000, maxWait: 10_000 },
  );

  for (const user of users) {
    options.log(`Demo akkaunt tayyor: ${user.phone} (${user.role})`);
  }
}

async function upsertDemoUser(
  tx: Tx,
  account: DemoAccount,
  passwordHash: string,
): Promise<User> {
  const existing = await tx.user.findUnique({
    where: { phone: account.phone },
  });
  if (existing && !existing.isDemo) {
    // Demo data must never mix with (or overwrite) real accounts.
    throw new DemoSeedError(
      `${account.key}: telefon demo bo‘lmagan akkauntga tegishli — seed to‘xtatildi`,
    );
  }
  if (existing && existing.role !== account.role) {
    // Roles are never changed silently. A mismatch means a DEMO_*_PHONE that
    // points at another demo account, or a database seeded by an older demo
    // layout (the staff numbers used to be assigned differently).
    throw new DemoSeedError(
      `${account.key}: ${account.phone} demo akkaunti bazada ${existing.role} roli bilan bor, ` +
        `seed esa ${account.role} kutadi (mavjud akkaunt roli o‘zgartirilmaydi). ` +
        '.env dagi DEMO_*_PHONE qiymatlarini tekshiring; dev baza demo akkauntlarning ' +
        'eski tartibi bilan yaratilgan bo‘lsa, uni qayta yarating: npm run dev:reset ' +
        '(barcha dev volume’lar o‘chadi).',
    );
  }
  if (account.email) {
    const owner = await tx.user.findUnique({ where: { email: account.email } });
    if (owner && owner.id !== existing?.id) {
      throw new DemoSeedError(
        `${account.key}: email boshqa akkauntga tegishli — seed to‘xtatildi`,
      );
    }
  }

  if (!existing) {
    const now = new Date();
    return tx.user.create({
      data: {
        phone: account.phone,
        email: account.email,
        fullName: account.fullName,
        role: account.role,
        status: UserStatus.ACTIVE,
        phoneVerifiedAt: now,
        passwordChangedAt: now,
        isDemo: true,
        passwordHash,
        // MFA is not pre-enrolled: SUPER_ADMIN/ADMIN set up TOTP at first login.
      },
    });
  }

  const passwordChanged = !(await verifyPassword(
    account.password,
    existing.passwordHash,
  ));
  const updated = await tx.user.update({
    where: { id: existing.id },
    data: {
      fullName: account.fullName,
      email: account.email,
      ...(passwordChanged
        ? { passwordHash, passwordChangedAt: new Date() }
        : {}),
    },
  });
  if (passwordChanged) {
    await tx.session.updateMany({
      where: { userId: existing.id, revokedAt: null },
      data: {
        revokedAt: new Date(),
        revokedReason: SessionRevokeReason.PASSWORD_CHANGED,
      },
    });
  }
  return updated;
}

async function ensureFarm(tx: Tx, farmer: User): Promise<void> {
  const farm =
    (await tx.farm.findFirst({
      where: { ownerId: farmer.id, name: DEMO_FARM.name, archivedAt: null },
    })) ??
    (await tx.farm.create({ data: { ...DEMO_FARM, ownerId: farmer.id } }));

  for (const animal of DEMO_ANIMALS) {
    const exists = await tx.animal.findFirst({
      where: { farmId: farm.id, tagNumber: animal.tagNumber, archivedAt: null },
      select: { id: true },
    });
    if (!exists) {
      await tx.animal.create({
        data: { ...animal, farmId: farm.id, notes: 'Demo hayvon' },
      });
    }
  }

  for (const { initialQuantity, unitPrice, ...item } of DEMO_INVENTORY) {
    const exists = await tx.inventoryItem.findFirst({
      where: { farmId: farm.id, name: item.name, archivedAt: null },
      select: { id: true },
    });
    if (exists) continue;
    // Like the API: a priced IN movement sets the item's current price.
    const created = await tx.inventoryItem.create({
      data: { ...item, farmId: farm.id, quantity: initialQuantity, unitPrice },
    });
    await tx.stockMovement.create({
      data: {
        itemId: created.id,
        farmId: farm.id,
        type: StockMovementType.IN,
        quantity: initialQuantity,
        balanceAfter: initialQuantity,
        unitCost: unitPrice,
        currency: unitPrice === null ? null : 'UZS',
        reason: 'Demo boshlang‘ich qoldiq',
        actorId: farmer.id,
      },
    });
  }
}

/**
 * Demo medicines and the demo protocol stay DRAFT forever: they are
 * flagged isDemo, which the database refuses to approve.
 */
async function ensureClinicalDrafts(tx: Tx, vet: User): Promise<void> {
  const medicineIds = new Map<string, string>();
  for (const { key, ...medicine } of DEMO_MEDICINES) {
    const found =
      (await tx.medicine.findFirst({
        where: { name: medicine.name, isDemo: true },
        select: { id: true },
      })) ??
      (await tx.medicine.create({
        data: { ...medicine, isDemo: true, createdById: vet.id },
        select: { id: true },
      }));
    medicineIds.set(key, found.id);
  }

  const existing = await tx.protocol.findUnique({
    where: { code: DEMO_PROTOCOL.code },
  });
  if (existing) {
    if (!existing.isDemo) {
      throw new DemoSeedError(
        `${DEMO_PROTOCOL.code} protokol kodi demo bo‘lmagan protokolga tegishli`,
      );
    }
    return;
  }
  await tx.protocol.create({
    data: {
      code: DEMO_PROTOCOL.code,
      species: DEMO_PROTOCOL.species,
      isDemo: true,
      createdById: vet.id,
      versions: {
        create: {
          version: 1,
          title: DEMO_PROTOCOL.title,
          condition: DEMO_PROTOCOL.condition,
          instructions: DEMO_PROTOCOL.instructions,
          isEmergency: false,
          createdById: vet.id,
          drugs: {
            create: DEMO_PROTOCOL.drugs.map(({ medicine, ...drug }, index) => ({
              ...drug,
              medicineId: medicineIds.get(medicine)!,
              sortOrder: index,
            })),
          },
        },
      },
    },
  });
}
