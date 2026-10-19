import { randomUUID } from 'node:crypto';
import {
  addDays,
  dateOnlyToDate,
  todayInTashkent,
} from '../../src/common/time.js';
import type { Animal, Farm, User } from '../../src/generated/prisma/client.js';
import {
  MedicineStatus,
  Species,
  UserRole,
} from '../../src/generated/prisma/enums.js';
import type { TestApp } from '../utils/app.js';
import { loginAs } from '../utils/auth.js';
import {
  createAnimal,
  createFarm,
  createInventoryItem,
  createMedicine,
  createProtocolWithVersion,
  createUser,
  uniqueSuffix,
} from '../utils/factories.js';

export const MEDICINES = '/api/v1/vet/medicines';
export const PROTOCOLS = '/api/v1/vet/protocols';
export const RECOMMENDATIONS = '/api/v1/vet/recommendations';
export const TREATMENTS = '/api/v1/vet/treatments';

export const versionUrl = (protocolId: string, versionId: string) =>
  `${PROTOCOLS}/${protocolId}/versions/${versionId}`;
export const newKey = () => `vet-${randomUUID()}`;
export const today = () => todayInTashkent();
/** Tashkent calendar date `days` from today, as a @db.Date value. */
export const dayFromToday = (days: number) =>
  dateOnlyToDate(addDays(todayInTashkent(), days));

export interface Actor {
  user: User;
  auth: { Authorization: string };
}

/** A fresh ACTIVE user of `role` with a live (MFA-verified) session. */
export async function actor(
  testApp: TestApp,
  role: UserRole,
  options: { isDemo?: boolean } = {},
): Promise<Actor> {
  const { user } = await createUser(testApp.prisma, {
    role,
    isDemo: options.isDemo,
    mfaEnabled: role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN,
  });
  return { user, auth: (await loginAs(testApp, user)).authHeader };
}

export interface Farmer extends Actor {
  farm: Farm;
  animal: Animal;
}

/** A farmer with one farm and one 450 kg cattle animal. */
export async function farmer(
  testApp: TestApp,
  animal: { species?: Species; weightKg?: string | null } = {},
): Promise<Farmer> {
  const base = await actor(testApp, UserRole.FARMER);
  const farm = await createFarm(testApp.prisma, { ownerId: base.user.id });
  return {
    ...base,
    farm,
    animal: await createAnimal(testApp.prisma, {
      farmId: farm.id,
      species: animal.species ?? Species.CATTLE,
      weightKg: animal.weightKg,
    }),
  };
}

/** An APPROVED medicine (approved by a fresh VET). */
export function approvedMedicine(
  testApp: TestApp,
  options: { withdrawalMeatDays?: number; withdrawalMilkDays?: number } = {},
) {
  return createMedicine(testApp.prisma, {
    status: MedicineStatus.APPROVED,
    ...options,
  });
}

/** Approved CATTLE protocol with one drug: 0.2 ml/kg IM, 1×/day, 3 days. */
export function approvedProtocol(
  testApp: TestApp,
  options: Parameters<typeof createProtocolWithVersion>[1] = {},
) {
  return createProtocolWithVersion(testApp.prisma, {
    approved: true,
    condition: `test-${uniqueSuffix()}`,
    ...options,
  });
}

/** A stocked MEDICINE item that stays usable long after any test course. */
export function medicineItem(
  testApp: TestApp,
  farmId: string,
  medicineId: string,
  options: Partial<Parameters<typeof createInventoryItem>[1]> = {},
) {
  return createInventoryItem(testApp.prisma, {
    farmId,
    medicineId,
    quantity: '100',
    unit: 'ML',
    batchNumber: `B-${uniqueSuffix()}`,
    expiresOn: dayFromToday(365),
    ...options,
  });
}

export function postTreatment(
  testApp: TestApp,
  auth: { Authorization: string },
  body: object,
  key: string = newKey(),
) {
  return testApp
    .http()
    .post(TREATMENTS)
    .set(auth)
    .set('Idempotency-Key', key)
    .send(body);
}

export function auditRows(
  testApp: TestApp,
  resourceType: string,
  resourceId: string,
) {
  return testApp.prisma.auditLog.findMany({
    where: { resourceType, resourceId },
    orderBy: { timestamp: 'asc' },
  });
}

export function treatmentCount(testApp: TestApp, animalId: string) {
  return testApp.prisma.treatment.count({ where: { animalId } });
}

/** Minimal valid protocol creation body. */
export function protocolBody(
  medicineIds: string[],
  overrides: {
    isEmergency?: boolean;
    condition?: string;
    species?: Species;
  } = {},
) {
  return {
    code: `T-${uniqueSuffix().toUpperCase()}`,
    species: overrides.species ?? Species.CATTLE,
    version: {
      title: 'Mastit davolash',
      condition: overrides.condition ?? `mastit-${uniqueSuffix()}`,
      isEmergency: overrides.isEmergency ?? false,
      instructions: 'Kuniga bir marta mushak ichiga yuboriladi.',
      drugs: medicineIds.map((medicineId) => ({
        medicineId,
        dosePerKg: '0.2',
        doseUnit: 'ML',
        route: 'IM',
        frequencyPerDay: 1,
        durationDays: 3,
      })),
    },
  };
}
