import type { AnimalSex, Species } from '@/features/animals/api/animals.api';
import type { InventoryItem, StockMovement } from '@/features/inventory/api/inventory.api';
import { http } from '@/shared/api/client';
import { cleanParams } from '@/shared/api/pagination';
import type { PageQuery, Paginated } from '@/shared/types/api';

/** Backend enums (prisma: RationProfile, FeedingPurpose, PhysiologicalState). */
export const RATION_PROFILES = ['BULL', 'COW', 'RAM', 'EWE', 'OTHER'] as const;
export type RationProfile = (typeof RATION_PROFILES)[number];

export const FEEDING_PURPOSES = ['FATTENING', 'MAINTENANCE', 'MILK', 'BREEDING'] as const;
export type FeedingPurpose = (typeof FEEDING_PURPOSES)[number];

export const PHYSIOLOGICAL_STATES = ['NORMAL', 'PREGNANT', 'LACTATING', 'DRY'] as const;
export type PhysiologicalState = (typeof PHYSIOLOGICAL_STATES)[number];

export type ProfileField = 'averageWeightKg' | 'ageMonths' | 'milkYieldLiters';

/** Server configuration of one profile: what the ration form asks for. No feeding norms. */
export interface ProfileConfig {
  profile: RationProfile;
  purposes: FeedingPurpose[];
  states: PhysiologicalState[];
  fields: ProfileField[];
}

export interface AnimalType {
  id: string;
  farmId: string;
  name: string;
  profile: RationProfile;
  species: Species;
  /** null — any sex. */
  sex: Extract<AnimalSex, 'MALE' | 'FEMALE'> | null;
  isDefault: boolean;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RationItem {
  inventoryItemId: string;
  /** Per animal per day, in the item unit (decimal string, 3 dp). */
  dailyPerAnimal: string;
  position: number;
  item: Pick<InventoryItem, 'id' | 'name' | 'unit' | 'category' | 'quantity' | 'unitPrice' | 'minQuantity' | 'archivedAt'>;
}

export interface Ration {
  id: string;
  farmId: string;
  animalTypeId: string;
  animalType: Pick<AnimalType, 'id' | 'name' | 'profile' | 'species' | 'sex'>;
  name: string;
  animalCount: number;
  averageWeightKg: string | null;
  ageMonths: number | null;
  purpose: FeedingPurpose;
  physiologicalState: PhysiologicalState | null;
  milkYieldLiters: string | null;
  days: number;
  notes: string | null;
  items: RationItem[];
  /** The latest "Sarfni ombordan chiqarish" (null — never issued); covers `days` days from its date. */
  lastIssue: { id: string; createdAt: string; days: number } | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RationIssue {
  id: string;
  rationId: string;
  farmId: string;
  days: number;
  animalCount: number;
  actorId: string;
  createdAt: string;
  movements: StockMovement[];
}

export interface RationInput {
  animalTypeId: string;
  name: string;
  animalCount: number;
  averageWeightKg?: string | null;
  ageMonths?: number | null;
  purpose: FeedingPurpose;
  physiologicalState?: PhysiologicalState | null;
  milkYieldLiters?: string | null;
  days: number;
  notes?: string | null;
  items: Array<{ inventoryItemId: string; dailyPerAnimal: string }>;
}

export interface CreateAnimalTypeInput {
  farmId: string;
  name: string;
  species: Species;
  profile?: RationProfile;
  sex?: 'MALE' | 'FEMALE';
}

export interface RationListQuery extends PageQuery {
  farmId?: string;
  animalTypeId?: string;
  includeArchived?: boolean;
}

/** /api/v1/rations — FARMER only. Saving or calculating never changes stock; only `issue` does. */
export const rationsApi = {
  async profiles(): Promise<ProfileConfig[]> {
    const { data } = await http.get<ProfileConfig[]>('/rations/profiles');
    return data;
  },

  async animalTypes(farmId: string): Promise<AnimalType[]> {
    const { data } = await http.get<AnimalType[]>('/rations/animal-types', { params: { farmId } });
    return data;
  },

  async createAnimalType(body: CreateAnimalTypeInput): Promise<AnimalType> {
    const { data } = await http.post<AnimalType>('/rations/animal-types', body);
    return data;
  },

  async archiveAnimalType(id: string): Promise<AnimalType> {
    const { data } = await http.post<AnimalType>(`/rations/animal-types/${id}/archive`, {});
    return data;
  },

  async list(query: RationListQuery): Promise<Paginated<Ration>> {
    const { data } = await http.get<Paginated<Ration>>('/rations', { params: cleanParams({ ...query }) });
    return data;
  },

  async get(id: string): Promise<Ration> {
    const { data } = await http.get<Ration>(`/rations/${id}`);
    return data;
  },

  async create(farmId: string, body: RationInput): Promise<Ration> {
    const { data } = await http.post<Ration>('/rations', { farmId, ...body });
    return data;
  },

  async update(id: string, body: Partial<RationInput>): Promise<Ration> {
    const { data } = await http.patch<Ration>(`/rations/${id}`, body);
    return data;
  },

  async copy(id: string): Promise<Ration> {
    const { data } = await http.post<Ration>(`/rations/${id}/copy`, {});
    return data;
  },

  async archive(id: string): Promise<Ration> {
    const { data } = await http.post<Ration>(`/rations/${id}/archive`, {});
    return data;
  },

  /** Writes the real consumption (OUT movements); one Idempotency-Key per dialog session. */
  async issue(id: string, days: number, idempotencyKey: string): Promise<RationIssue> {
    const { data } = await http.post<RationIssue>(
      `/rations/${id}/issue`,
      { days },
      { headers: { 'Idempotency-Key': idempotencyKey } },
    );
    return data;
  },

  async issues(id: string, query: PageQuery = {}): Promise<Paginated<RationIssue>> {
    const { data } = await http.get<Paginated<RationIssue>>(`/rations/${id}/issues`, { params: cleanParams({ ...query }) });
    return data;
  },
};
