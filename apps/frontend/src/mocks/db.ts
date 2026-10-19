/**
 * In-memory data for the mock backend (development "namuna rejimi" and
 * tests). Shapes follow the backend contract; values are obviously fake.
 * Nothing here is used in production builds.
 */
import type { Animal } from '@/features/animals/api/animals.api';
import type { AuditLog } from '@/features/audit/api/audit.api';
import type { Farm } from '@/features/farms/api/farms.api';
import type { InventoryItem, StockMovement } from '@/features/inventory/api/inventory.api';
import type { Medicine } from '@/features/medicines/api/medicines.api';
import type { AnimalType, Ration, RationIssue } from '@/features/rations/api/rations.api';
import type { PublicUser, UserRole } from '@/shared/types/api';

/** Stored ration: items without the joined inventory data (the server joins on read). */
export type MockRation = Omit<Ration, 'animalType' | 'items' | 'lastIssue'> & {
  items: Array<{ inventoryItemId: string; dailyPerAnimal: string; position: number }>;
};
/** Stored issue: its movements are the ledger rows with this rationIssueId. */
export type MockRationIssue = Omit<RationIssue, 'movements'>;

export interface MockUser extends PublicUser {
  password: string;
}

export interface MockSession {
  id: string;
  userId: string;
  accessToken: string;
  refreshToken: string;
  mfaVerified: boolean;
  createdAt: string;
  lastUsedAt: string;
  userAgent: string | null;
  revoked: boolean;
}

export interface MockMfaToken {
  token: string;
  userId: string;
  purpose: 'challenge' | 'setup';
  used: boolean;
}

export interface MockOtp {
  verificationId: string;
  phone: string;
  purpose: 'PHONE_VERIFICATION' | 'PASSWORD_RESET';
  code: string;
  consumed: boolean;
}

export interface MockDb {
  users: MockUser[];
  sessions: MockSession[];
  mfaTokens: MockMfaToken[];
  otps: MockOtp[];
  sms: Array<{ to: string; text: string; sentAt: string }>;
  farms: Array<Farm & { ownerId: string }>;
  animals: Animal[];
  items: InventoryItem[];
  movements: StockMovement[];
  rationAnimalTypes: AnimalType[];
  rations: MockRation[];
  rationIssues: MockRationIssue[];
  medicines: Medicine[];
  auditLogs: AuditLog[];
  idempotency: Record<string, { hash: string; status: number; body: unknown }>;
  /** The browser's refresh cookie, simulated: session id or null. */
  refreshCookie: string | null;
  csrfToken: string | null;
  sequence: number;
}

export const MOCK_MFA_CODE = '123456';

let counter = 0;
/** Deterministic, UUID-shaped ids (v4 layout) for stable tests. */
export function mockId(prefix = 0): string {
  counter += 1;
  const hex = (counter + prefix * 1_000_000).toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

const NOW = Date.parse('2026-10-16T09:00:00.000Z');
function daysAgo(days: number, hour = 0): string {
  return new Date(NOW - days * 86_400_000 + hour * 3_600_000).toISOString();
}

function user(role: UserRole, phone: string, fullName: string, password: string, overrides: Partial<MockUser> = {}): MockUser {
  return {
    id: mockId(1),
    phone,
    email: null,
    fullName,
    role,
    status: 'ACTIVE',
    phoneVerifiedAt: daysAgo(90),
    mfaEnabled: false,
    isDemo: true,
    lastLoginAt: daysAgo(1),
    createdAt: daysAgo(90),
    updatedAt: daysAgo(10),
    blockedAt: null,
    archivedAt: null,
    password,
    ...overrides,
  };
}

export const MOCK_PASSWORDS = {
  superAdmin: 'DemoAdmin123!',
  farmer: 'DemoFarmer123!',
  staff: 'DemoStaff123!',
} as const;

export function createSeedDb(): MockDb {
  counter = 0;
  const superAdmin = user('SUPER_ADMIN', '+998900000001', 'Demo Super Admin', MOCK_PASSWORDS.superAdmin, {
    email: 'admin@meningfermam.local',
  });
  const farmer = user('FARMER', '+998900000002', 'Demo Fermer', MOCK_PASSWORDS.farmer, {
    email: 'farmer@meningfermam.local',
  });
  const admin = user('ADMIN', '+998900000003', 'Demo Administrator', MOCK_PASSWORDS.staff, { mfaEnabled: true });
  const vet = user('VET', '+998900000004', 'Demo Veterinar', MOCK_PASSWORDS.staff);
  const support = user('SUPPORT', '+998900000005', 'Demo Operator', MOCK_PASSWORDS.staff);
  const otherFarmers = [
    user('FARMER', '+998900000006', 'Namuna Fermer Bir', MOCK_PASSWORDS.staff),
    user('FARMER', '+998900000007', 'Namuna Fermer Ikki', MOCK_PASSWORDS.staff, {
      status: 'BLOCKED',
      blockedAt: daysAgo(3),
    }),
    user('FARMER', '+998900000008', 'Namuna Fermer Uch', MOCK_PASSWORDS.staff, {
      status: 'PENDING_VERIFICATION',
      phoneVerifiedAt: null,
      lastLoginAt: null,
    }),
  ];

  const farm = {
    id: mockId(2),
    ownerId: farmer.id,
    name: 'Namuna ferma',
    region: 'Toshkent viloyati',
    archivedAt: null,
    createdAt: daysAgo(80),
    updatedAt: daysAgo(80),
  };

  const animalSeed: Array<Pick<Animal, 'tagNumber' | 'name' | 'species' | 'sex' | 'birthDate' | 'weightKg'>> = [
    { tagNumber: 'UZ-001', name: 'Oqqiz', species: 'CATTLE', sex: 'FEMALE', birthDate: '2021-04-12', weightKg: '480.50' },
    { tagNumber: 'UZ-002', name: 'Qoraqash', species: 'CATTLE', sex: 'FEMALE', birthDate: '2022-02-03', weightKg: '455.00' },
    { tagNumber: 'UZ-003', name: 'Bahodir', species: 'CATTLE', sex: 'MALE', birthDate: '2020-09-21', weightKg: '690.00' },
    { tagNumber: 'UZ-004', name: null, species: 'CATTLE', sex: 'FEMALE', birthDate: '2026-03-01', weightKg: '120.00' },
    { tagNumber: 'UZ-010', name: null, species: 'SHEEP', sex: 'FEMALE', birthDate: '2024-03-15', weightKg: '52.30' },
    { tagNumber: 'UZ-011', name: null, species: 'SHEEP', sex: 'FEMALE', birthDate: '2024-04-02', weightKg: '49.80' },
    { tagNumber: 'UZ-012', name: 'Hisori', species: 'SHEEP', sex: 'MALE', birthDate: '2023-01-20', weightKg: '84.00' },
    { tagNumber: 'UZ-013', name: null, species: 'SHEEP', sex: 'UNKNOWN', birthDate: null, weightKg: null },
    { tagNumber: 'UZ-020', name: null, species: 'GOAT', sex: 'FEMALE', birthDate: '2025-05-10', weightKg: '31.00' },
    { tagNumber: 'UZ-030', name: 'Jiyron', species: 'HORSE', sex: 'MALE', birthDate: '2019-06-01', weightKg: '420.00' },
    { tagNumber: 'UZ-100', name: null, species: 'POULTRY', sex: 'FEMALE', birthDate: '2026-01-05', weightKg: '1.80' },
    { tagNumber: 'UZ-101', name: null, species: 'POULTRY', sex: 'FEMALE', birthDate: '2026-01-05', weightKg: '1.75' },
  ];
  const animals: Animal[] = animalSeed.map((animal, index) => ({
    id: mockId(3),
    farmId: farm.id,
    notes: null,
    archivedAt: null,
    archivedReason: null,
    createdAt: daysAgo(70 - index),
    updatedAt: daysAgo(70 - index),
    ...animal,
  }));

  const approvedMedicine: Medicine = {
    id: mockId(4),
    name: 'Namuna dori №1',
    activeIngredient: 'Namuna modda',
    form: 'Eritma',
    concentration: null,
    withdrawalMeatDays: 0,
    withdrawalMilkDays: 0,
    status: 'APPROVED',
    isDemo: false,
    approvedAt: daysAgo(30),
    createdAt: daysAgo(40),
    updatedAt: daysAgo(30),
  };
  const draftMedicine: Medicine = {
    id: mockId(4),
    name: 'DEMO — klinik tasdiqlanmagan namuna',
    activeIngredient: 'Namuna modda',
    form: null,
    concentration: null,
    withdrawalMeatDays: 0,
    withdrawalMilkDays: 0,
    status: 'DRAFT',
    isDemo: true,
    approvedAt: null,
    createdAt: daysAgo(20),
    updatedAt: daysAgo(20),
  };

  const items: InventoryItem[] = [];
  const movements: StockMovement[] = [];

  function addItem(
    partial: Pick<InventoryItem, 'name' | 'category' | 'unit'> & Partial<InventoryItem>,
    history: Array<[StockMovement['type'], string, string | null, number]>,
  ) {
    const item: InventoryItem = {
      id: mockId(5),
      farmId: farm.id,
      quantity: '0',
      medicineId: null,
      batchNumber: null,
      expiresOn: null,
      openedAt: null,
      useWithinDaysAfterOpening: null,
      unitPrice: null,
      minQuantity: null,
      archivedAt: null,
      createdAt: daysAgo(60),
      updatedAt: daysAgo(1),
      ...partial,
    };
    let balance = 0n;
    for (const [type, quantity, unitCost, ago] of history) {
      // Like the API: every priced purchase becomes the item's current price.
      if (type === 'IN' && unitCost) item.unitPrice = unitCost;
      const units = BigInt(quantity) * 1000n;
      balance += type === 'IN' || type === 'ADJUSTMENT_IN' ? units : -units;
      movements.push({
        id: mockId(6),
        itemId: item.id,
        farmId: farm.id,
        type,
        quantity: `${quantity}.000`,
        balanceAfter: `${balance / 1000n}.000`,
        unitCost,
        currency: unitCost ? 'UZS' : null,
        reason: type.startsWith('ADJUSTMENT') ? 'Inventarizatsiya' : null,
        actorId: farmer.id,
        rationIssueId: null,
        createdAt: daysAgo(ago, 3),
      });
    }
    item.quantity = `${balance / 1000n}.000`;
    items.push(item);
  }

  addItem({ name: 'Arpa', category: 'FEED', unit: 'KG' }, [
    ['IN', '2000', '3200.00', 55],
    ['OUT', '450', null, 40],
    ['OUT', '300', null, 12],
    ['IN', '500', '3400.00', 6],
    ['OUT', '500', null, 2],
  ]);
  addItem({ name: 'Pichan', category: 'FEED', unit: 'KG' }, [
    ['IN', '5000', '1500.00', 50],
    ['OUT', '1600', null, 20],
  ]);
  addItem({ name: 'Kepak', category: 'FEED', unit: 'KG' }, [['IN', '600', '2500.00', 15]]);
  // Below its minimum (120 ≤ 200 kg): shows the low-stock warning.
  addItem({ name: 'Omuxta yem', category: 'FEED', unit: 'KG', minQuantity: '200.000' }, [
    ['IN', '1000', '4800.00', 33],
    ['OUT', '880', null, 4],
  ]);
  addItem(
    {
      name: 'Namuna dori №1',
      category: 'MEDICINE',
      unit: 'ML',
      medicineId: approvedMedicine.id,
      batchNumber: 'NB-2026-01',
      expiresOn: '2026-11-05',
    },
    [['IN', '500', '120.00', 25]],
  );
  addItem({ name: 'Bir martalik shprits', category: 'EQUIPMENT', unit: 'PIECE' }, [['IN', '100', '1500.00', 25]]);

  return {
    users: [superAdmin, farmer, admin, vet, support, ...otherFarmers],
    sessions: [],
    mfaTokens: [],
    otps: [],
    sms: [],
    farms: [farm],
    animals,
    items,
    movements,
    // Default animal types are created on the first list, like the API.
    rationAnimalTypes: [],
    rations: [],
    rationIssues: [],
    medicines: [approvedMedicine, draftMedicine],
    auditLogs: [
      {
        id: mockId(7),
        actorId: superAdmin.id,
        actorRole: 'SUPER_ADMIN',
        action: 'user.blocked',
        resourceType: 'user',
        resourceId: otherFarmers[1]?.id ?? null,
        oldValue: { status: 'ACTIVE' },
        newValue: { status: 'BLOCKED' },
        ip: '127.0.0.1',
        userAgent: 'Mock',
        requestId: 'mock-request-0001',
        timestamp: daysAgo(3),
      },
    ],
    idempotency: {},
    refreshCookie: null,
    csrfToken: null,
    sequence: 1,
  };
}
