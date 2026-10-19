import type {
  Prisma,
  RationAnimalType,
  RationIssue,
} from '../generated/prisma/client.js';
import type {
  AnimalSex,
  FeedingPurpose,
  InventoryCategory,
  InventoryUnit,
  PhysiologicalState,
  RationProfile,
  Species,
} from '../generated/prisma/enums.js';
import {
  optionalDecimalString,
  type StockMovementResponse,
} from '../inventory/inventory.presenter.js';
import {
  decimalString,
  PRICE_SCALE,
  QUANTITY_SCALE,
} from '../inventory/stock-balance.js';

/** Scale of rations.average_weight_kg / milk_yield_liters. */
const PARAMETER_SCALE = 2;

export interface RationAnimalTypeResponse {
  id: string;
  farmId: string;
  name: string;
  profile: RationProfile;
  species: Species;
  /** null = any sex (never UNKNOWN). */
  sex: AnimalSex | null;
  isDefault: boolean;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RationItemResponse {
  inventoryItemId: string;
  /** 3 fraction digits. */
  dailyPerAnimal: string;
  position: number;
  item: {
    id: string;
    name: string;
    unit: InventoryUnit;
    category: InventoryCategory;
    quantity: string;
    unitPrice: string | null;
    minQuantity: string | null;
    archivedAt: Date | null;
  };
}

export interface RationResponse {
  id: string;
  farmId: string;
  animalTypeId: string;
  animalType: Pick<
    RationAnimalTypeResponse,
    'id' | 'name' | 'profile' | 'species' | 'sex'
  >;
  name: string;
  animalCount: number;
  /** 2 fraction digits. */
  averageWeightKg: string | null;
  ageMonths: number | null;
  purpose: FeedingPurpose;
  physiologicalState: PhysiologicalState | null;
  /** 2 fraction digits. */
  milkYieldLiters: string | null;
  days: number;
  notes: string | null;
  /** In the order the client sent them (position). */
  items: RationItemResponse[];
  /** Most recent issue (createdAt desc, id desc); null before the first. */
  lastIssue: RationLastIssue | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Enough for "was today's ration given?": an issue covers the days from its
 * date (Asia/Tashkent) through date + days − 1.
 */
export interface RationLastIssue {
  id: string;
  createdAt: Date;
  days: number;
}

export interface RationIssueResponse {
  id: string;
  rationId: string;
  farmId: string;
  days: number;
  animalCount: number;
  actorId: string;
  createdAt: Date;
  movements: StockMovementResponse[];
}

export const RATION_INCLUDE = {
  animalType: true,
  items: { orderBy: { position: 'asc' }, include: { inventoryItem: true } },
} satisfies Prisma.RationInclude;

export type RationRow = Prisma.RationGetPayload<{
  include: typeof RATION_INCLUDE;
}>;

export function toAnimalTypeResponse(
  type: RationAnimalType,
): RationAnimalTypeResponse {
  return {
    id: type.id,
    farmId: type.farmId,
    name: type.name,
    profile: type.profile,
    species: type.species,
    sex: type.sex,
    isDefault: type.isDefault,
    archivedAt: type.archivedAt,
    createdAt: type.createdAt,
    updatedAt: type.updatedAt,
  };
}

export function toRationResponse(
  ration: RationRow,
  lastIssue: RationLastIssue | null,
): RationResponse {
  return {
    id: ration.id,
    farmId: ration.farmId,
    animalTypeId: ration.animalTypeId,
    animalType: {
      id: ration.animalType.id,
      name: ration.animalType.name,
      profile: ration.animalType.profile,
      species: ration.animalType.species,
      sex: ration.animalType.sex,
    },
    name: ration.name,
    animalCount: ration.animalCount,
    averageWeightKg: optionalDecimalString(
      ration.averageWeightKg,
      PARAMETER_SCALE,
    ),
    ageMonths: ration.ageMonths,
    purpose: ration.purpose,
    physiologicalState: ration.physiologicalState,
    milkYieldLiters: optionalDecimalString(
      ration.milkYieldLiters,
      PARAMETER_SCALE,
    ),
    days: ration.days,
    notes: ration.notes,
    items: ration.items.map(({ inventoryItem: item, ...line }) => ({
      inventoryItemId: line.inventoryItemId,
      dailyPerAnimal: decimalString(line.dailyPerAnimal, QUANTITY_SCALE),
      position: line.position,
      item: {
        id: item.id,
        name: item.name,
        unit: item.unit,
        category: item.category,
        quantity: decimalString(item.quantity, QUANTITY_SCALE),
        unitPrice: optionalDecimalString(item.unitPrice, PRICE_SCALE),
        minQuantity: optionalDecimalString(item.minQuantity, QUANTITY_SCALE),
        archivedAt: item.archivedAt,
      },
    })),
    lastIssue: lastIssue
      ? {
          id: lastIssue.id,
          createdAt: lastIssue.createdAt,
          days: lastIssue.days,
        }
      : null,
    archivedAt: ration.archivedAt,
    createdAt: ration.createdAt,
    updatedAt: ration.updatedAt,
  };
}

/** Compact audit snapshot: the plan itself, without stock levels. */
export function rationAuditValue(ration: RationResponse) {
  return {
    farmId: ration.farmId,
    animalTypeId: ration.animalTypeId,
    name: ration.name,
    animalCount: ration.animalCount,
    averageWeightKg: ration.averageWeightKg,
    ageMonths: ration.ageMonths,
    purpose: ration.purpose,
    physiologicalState: ration.physiologicalState,
    milkYieldLiters: ration.milkYieldLiters,
    days: ration.days,
    notes: ration.notes,
    archivedAt: ration.archivedAt,
    items: ration.items.map((line) => ({
      inventoryItemId: line.inventoryItemId,
      dailyPerAnimal: line.dailyPerAnimal,
    })),
  };
}

/** Movements in ledger order (the same order history lists them in). */
export function compareMovements(
  a: Pick<StockMovementResponse, 'createdAt' | 'id'>,
  b: Pick<StockMovementResponse, 'createdAt' | 'id'>,
): number {
  const byTime = a.createdAt.getTime() - b.createdAt.getTime();
  if (byTime !== 0) return byTime;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export function toIssueResponse(
  issue: RationIssue,
  movements: StockMovementResponse[],
): RationIssueResponse {
  return {
    id: issue.id,
    rationId: issue.rationId,
    farmId: issue.farmId,
    days: issue.days,
    animalCount: issue.animalCount,
    actorId: issue.actorId,
    createdAt: issue.createdAt,
    movements: [...movements].sort(compareMovements),
  };
}
