import { http } from '@/shared/api/client';
import { cleanParams, fetchAllPages, type AllPagesResult } from '@/shared/api/pagination';
import type { PageQuery, Paginated } from '@/shared/types/api';

/** Backend enums (prisma: Species, AnimalSex). */
export const SPECIES = ['CATTLE', 'SHEEP', 'GOAT', 'HORSE', 'POULTRY', 'OTHER'] as const;
export type Species = (typeof SPECIES)[number];

export const ANIMAL_SEXES = ['FEMALE', 'MALE', 'UNKNOWN'] as const;
export type AnimalSex = (typeof ANIMAL_SEXES)[number];

export interface Animal {
  id: string;
  farmId: string;
  tagNumber: string;
  name: string | null;
  species: Species;
  sex: AnimalSex;
  /** 'YYYY-MM-DD' */
  birthDate: string | null;
  /** Decimal string, kg, 2 dp. */
  weightKg: string | null;
  notes: string | null;
  archivedAt: string | null;
  archivedReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AnimalDetails extends Animal {
  /** Withdrawal period after treatment (meat/milk must not be used until then); each part may be null. */
  activeWithdrawal?: { meatUntil: string | null; milkUntil: string | null } | null;
}

export interface AnimalListQuery extends PageQuery {
  farmId?: string;
  species?: Species;
  includeArchived?: boolean;
}

export interface CreateAnimalInput {
  farmId: string;
  tagNumber: string;
  species: Species;
  sex?: AnimalSex;
  name?: string;
  birthDate?: string;
  weightKg?: string;
  notes?: string;
}

/** farmId cannot change after creation, so it is not part of the PATCH body. */
export type UpdateAnimalInput = Partial<Omit<CreateAnimalInput, 'farmId'>>;

/** /api/v1/animals — FARMER only (CONTRACT §7.1). No DELETE: animals are archived. */
export const animalsApi = {
  async list(query: AnimalListQuery): Promise<Paginated<Animal>> {
    const { data } = await http.get<Paginated<Animal>>('/animals', { params: cleanParams({ ...query }) });
    return data;
  },

  listAll(query: Omit<AnimalListQuery, 'page' | 'limit'>): Promise<AllPagesResult<Animal>> {
    return fetchAllPages((page, limit) => animalsApi.list({ ...query, page, limit }));
  },

  async get(id: string): Promise<AnimalDetails> {
    const { data } = await http.get<AnimalDetails>(`/animals/${id}`);
    return data;
  },

  async create(body: CreateAnimalInput): Promise<Animal> {
    const { data } = await http.post<Animal>('/animals', body);
    return data;
  },

  async update(id: string, body: UpdateAnimalInput): Promise<Animal> {
    const { data } = await http.patch<Animal>(`/animals/${id}`, body);
    return data;
  },

  async archive(id: string, reason: string): Promise<Animal> {
    const { data } = await http.post<Animal>(`/animals/${id}/archive`, { reason });
    return data;
  },
};
