import { randomBytes, randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import {
  AdministrationRoute,
  AnimalSex,
  DoseUnit,
  InventoryCategory,
  InventoryUnit,
  MedicineStatus,
  ProtocolVersionStatus,
  Species,
  UserRole,
  UserStatus,
} from '../../src/generated/prisma/enums.js';
import type {
  Animal,
  Farm,
  InventoryItem,
  Medicine,
  Prisma,
  PrismaClient,
  Protocol,
  ProtocolDrug,
  ProtocolVersion,
  User,
} from '../../src/generated/prisma/client.js';
import {
  buildKeyRing,
  encryptWithKey,
  mfaSecretAad,
} from '../../src/security/encryption.service.js';
import { hashPassword } from '../../src/security/password.js';
import { PHONE_PREFIX, PHONE_SEQUENCE_KEY } from './phone-sequence.js';
import { base32Encode } from './totp.js';

/** PrismaService / PrismaClient or a transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;

export const DEFAULT_TEST_PASSWORD = 'Test-password-123';

let sequenceRedis: Redis | undefined;

function redis(): Redis {
  sequenceRedis ??= new Redis(process.env.REDIS_URL ?? '', {
    maxRetriesPerRequest: 2,
  });
  return sequenceRedis;
}

export async function closeFactoryConnections(): Promise<void> {
  if (!sequenceRedis) return;
  const client = sequenceRedis;
  sequenceRedis = undefined;
  await client.quit().catch(() => client.disconnect());
}

/** Unique '+99899NNNNNNN' across all test files of a run (Redis INCR). */
export async function uniquePhone(): Promise<string> {
  const n = await redis().incr(PHONE_SEQUENCE_KEY);
  if (n > 9_999_999) {
    throw new Error('Test phone space exhausted; reset the test database');
  }
  return `${PHONE_PREFIX}${String(n).padStart(7, '0')}`;
}

export function uniqueSuffix(): string {
  return randomBytes(4).toString('hex');
}

export interface CreateUserOptions {
  role?: UserRole;
  status?: UserStatus;
  password?: string;
  isDemo?: boolean;
  mfaEnabled?: boolean;
  fullName?: string;
  phone?: string;
}

export interface CreatedUser {
  user: User;
  password: string;
  /** Base32 TOTP secret when `mfaEnabled` (use with totpNow). */
  mfaSecret?: string;
}

/** ACTIVE users get `phoneVerifiedAt`; MFA secrets are stored encrypted. */
export async function createUser(
  prisma: Db,
  options: CreateUserOptions = {},
): Promise<CreatedUser> {
  const id = randomUUID();
  const now = new Date();
  const status = options.status ?? UserStatus.ACTIVE;
  const password = options.password ?? DEFAULT_TEST_PASSWORD;
  const isDemo = options.isDemo ?? false;
  // Demo users too: demo status is the isDemo flag, not the phone range.
  const phone = options.phone ?? (await uniquePhone());
  const cost = Number(process.env.PASSWORD_SCRYPT_COST ?? 1024);

  let mfaSecret: string | undefined;
  let mfaSecretEnc: string | undefined;
  if (options.mfaEnabled) {
    mfaSecret = base32Encode(randomBytes(20));
    const [key] = buildKeyRing([process.env.DATA_ENCRYPTION_KEY ?? '']);
    mfaSecretEnc = encryptWithKey(key, mfaSecret, mfaSecretAad(id));
  }

  const user = await prisma.user.create({
    data: {
      id,
      phone,
      fullName: options.fullName ?? 'Test Foydalanuvchi',
      passwordHash: await hashPassword(password, cost),
      role: options.role ?? UserRole.FARMER,
      status,
      isDemo,
      phoneVerifiedAt: status === UserStatus.PENDING_VERIFICATION ? null : now,
      blockedAt: status === UserStatus.BLOCKED ? now : null,
      blockedReason: status === UserStatus.BLOCKED ? 'test' : null,
      archivedAt: status === UserStatus.ARCHIVED ? now : null,
      mfaEnabled: options.mfaEnabled ?? false,
      mfaSecretEnc: mfaSecretEnc ?? null,
      createdAt: now,
    },
  });
  return { user, password, mfaSecret };
}

export function createFarm(
  prisma: Db,
  options: { ownerId: string; name?: string; region?: string },
): Promise<Farm> {
  return prisma.farm.create({
    data: {
      ownerId: options.ownerId,
      name: options.name ?? `Test ferma ${uniqueSuffix()}`,
      region: options.region ?? null,
    },
  });
}

export function createAnimal(
  prisma: Db,
  options: {
    farmId: string;
    tagNumber?: string;
    species?: Species;
    sex?: AnimalSex;
    name?: string;
    weightKg?: string | null;
    birthDate?: Date | null;
  },
): Promise<Animal> {
  return prisma.animal.create({
    data: {
      farmId: options.farmId,
      tagNumber: options.tagNumber ?? `TAG-${uniqueSuffix()}`,
      species: options.species ?? Species.CATTLE,
      sex: options.sex ?? AnimalSex.FEMALE,
      name: options.name ?? null,
      weightKg: options.weightKg === undefined ? '450.00' : options.weightKg,
      birthDate: options.birthDate ?? null,
    },
  });
}

export function createInventoryItem(
  prisma: Db,
  options: {
    farmId: string;
    name?: string;
    category?: InventoryCategory;
    unit?: InventoryUnit;
    /** Set directly for test setup; the API only changes it via movements. */
    quantity?: string;
    medicineId?: string | null;
    batchNumber?: string | null;
    expiresOn?: Date | null;
    openedAt?: Date | null;
    useWithinDaysAfterOpening?: number | null;
  },
): Promise<InventoryItem> {
  return prisma.inventoryItem.create({
    data: {
      farmId: options.farmId,
      name: options.name ?? `Test mahsulot ${uniqueSuffix()}`,
      category:
        options.category ??
        (options.medicineId
          ? InventoryCategory.MEDICINE
          : InventoryCategory.FEED),
      unit: options.unit ?? InventoryUnit.KG,
      quantity: options.quantity ?? '0',
      medicineId: options.medicineId ?? null,
      batchNumber: options.batchNumber ?? null,
      expiresOn: options.expiresOn ?? null,
      openedAt: options.openedAt ?? null,
      useWithinDaysAfterOpening: options.useWithinDaysAfterOpening ?? null,
    },
  });
}

async function vetUserId(prisma: Db, candidate?: string): Promise<string> {
  if (candidate) return candidate;
  return (await createUser(prisma, { role: UserRole.VET })).user.id;
}

/**
 * The approver: `approvedById` if given; else the creator when the factory
 * created that creator as a VET itself; else a fresh VET (a caller-supplied
 * creator may be an ADMIN, and the DB lets only a current VET approve).
 */
async function approverId(
  prisma: Db,
  options: { createdById?: string; approvedById?: string },
  createdById: string,
): Promise<string> {
  if (options.approvedById) return options.approvedById;
  return options.createdById ? vetUserId(prisma) : createdById;
}

/**
 * Approval is done by a VET user, as the database requires. Demo medicines
 * can never be APPROVED (DB check), so that combination throws here.
 */
export async function createMedicine(
  prisma: Db,
  options: {
    status?: MedicineStatus;
    createdById?: string;
    /** Must be a user whose current role is VET. */
    approvedById?: string;
    isDemo?: boolean;
    name?: string;
    withdrawalMeatDays?: number;
    withdrawalMilkDays?: number;
  } = {},
): Promise<Medicine> {
  const status = options.status ?? MedicineStatus.DRAFT;
  if (options.isDemo && status === MedicineStatus.APPROVED) {
    throw new Error('createMedicine: demo medicines cannot be APPROVED');
  }
  const createdById = await vetUserId(prisma, options.createdById);
  let medicine = await prisma.medicine.create({
    data: {
      name: options.name ?? `Test dori ${uniqueSuffix()}`,
      activeIngredient: 'Testmitsin',
      form: 'inyeksiya',
      concentration: '10%',
      withdrawalMeatDays: options.withdrawalMeatDays ?? 7,
      withdrawalMilkDays: options.withdrawalMilkDays ?? 3,
      isDemo: options.isDemo ?? false,
      createdById,
    },
  });
  if (status === MedicineStatus.APPROVED) {
    medicine = await prisma.medicine.update({
      where: { id: medicine.id },
      data: {
        status: MedicineStatus.APPROVED,
        approvedById: await approverId(prisma, options, createdById),
        approvedAt: new Date(),
      },
    });
  } else if (status === MedicineStatus.ARCHIVED) {
    medicine = await prisma.medicine.update({
      where: { id: medicine.id },
      data: { status: MedicineStatus.ARCHIVED },
    });
  }
  return medicine;
}

export interface CreatedProtocol {
  protocol: Protocol;
  version: ProtocolVersion;
  drugs: ProtocolDrug[];
  medicineIds: string[];
}

/**
 * Protocol + version 1 (+ drugs); `approved` approves it as a VET (see
 * approverId). Demo protocols can never be approved (DB trigger), so that
 * combination throws here.
 */
export async function createProtocolWithVersion(
  prisma: Db,
  options: {
    approved?: boolean;
    species?: Species;
    isEmergency?: boolean;
    isDemo?: boolean;
    title?: string;
    condition?: string;
    createdById?: string;
    approvedById?: string;
    /** Default: one new APPROVED medicine. */
    medicineIds?: string[];
  } = {},
): Promise<CreatedProtocol> {
  if (options.isDemo && options.approved) {
    throw new Error(
      'createProtocolWithVersion: demo protocols cannot be approved',
    );
  }
  const createdById = await vetUserId(prisma, options.createdById);
  let approver: string | undefined;
  const approvedBy = async () =>
    (approver ??= await approverId(prisma, options, createdById));
  const medicineIds = options.medicineIds ?? [
    (
      await createMedicine(prisma, {
        status: MedicineStatus.APPROVED,
        createdById,
        approvedById: await approvedBy(),
      })
    ).id,
  ];

  const protocol = await prisma.protocol.create({
    data: {
      code: `TEST-${uniqueSuffix().toUpperCase()}`,
      species: options.species ?? Species.CATTLE,
      isDemo: options.isDemo ?? false,
      createdById,
    },
  });
  let version = await prisma.protocolVersion.create({
    data: {
      protocolId: protocol.id,
      version: 1,
      title: options.title ?? 'Test protokol',
      condition: options.condition ?? 'mastit',
      isEmergency: options.isEmergency ?? false,
      instructions: 'Test ko‘rsatmasi',
      createdById,
    },
  });
  const drugs: ProtocolDrug[] = [];
  for (const [index, medicineId] of medicineIds.entries()) {
    drugs.push(
      await prisma.protocolDrug.create({
        data: {
          protocolVersionId: version.id,
          medicineId,
          dosePerKg: '0.2000',
          doseUnit: DoseUnit.ML,
          route: AdministrationRoute.IM,
          frequencyPerDay: 1,
          durationDays: 3,
          sortOrder: index,
        },
      }),
    );
  }
  if (options.approved) {
    version = await prisma.protocolVersion.update({
      where: { id: version.id },
      data: {
        status: ProtocolVersionStatus.APPROVED,
        approvedById: await approvedBy(),
        approvedAt: new Date(),
      },
    });
  }
  return { protocol, version, drugs, medicineIds };
}
