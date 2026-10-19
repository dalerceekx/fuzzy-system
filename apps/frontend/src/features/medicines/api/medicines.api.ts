import { http } from '@/shared/api/client';
import { cleanParams, fetchAllPages } from '@/shared/api/pagination';
import type { PageQuery, Paginated } from '@/shared/types/api';

export const MEDICINE_STATUSES = ['DRAFT', 'APPROVED', 'ARCHIVED'] as const;
export type MedicineStatus = (typeof MEDICINE_STATUSES)[number];

export interface Medicine {
  id: string;
  name: string;
  activeIngredient: string;
  form: string | null;
  concentration: string | null;
  withdrawalMeatDays: number;
  withdrawalMilkDays: number;
  status: MedicineStatus;
  /** Demo/sample medicine: can never be approved. */
  isDemo: boolean;
  approvedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MedicineInput {
  name: string;
  activeIngredient: string;
  form?: string;
  concentration?: string;
  withdrawalMeatDays: number;
  withdrawalMilkDays: number;
}

/**
 * /api/v1/vet/medicines (CONTRACT §7.3). Farmers only ever receive APPROVED
 * medicines; staff see every status. Approval is VET-only.
 */
export const medicinesApi = {
  /** The contract defines no list filters: only page/limit are sent (unknown params → 400). */
  async list(query: Pick<PageQuery, 'page' | 'limit'> = {}): Promise<Paginated<Medicine>> {
    const { data } = await http.get<Paginated<Medicine>>('/vet/medicines', { params: cleanParams({ ...query }) });
    return data;
  },

  async listAll(): Promise<Medicine[]> {
    const result = await fetchAllPages((page, limit) => medicinesApi.list({ page, limit }), 1_000);
    return result.items;
  },

  async get(id: string): Promise<Medicine> {
    const { data } = await http.get<Medicine>(`/vet/medicines/${id}`);
    return data;
  },

  async create(body: MedicineInput): Promise<Medicine> {
    const { data } = await http.post<Medicine>('/vet/medicines', body);
    return data;
  },

  async update(id: string, body: Partial<MedicineInput>): Promise<Medicine> {
    const { data } = await http.patch<Medicine>(`/vet/medicines/${id}`, body);
    return data;
  },

  async approve(id: string): Promise<Medicine> {
    const { data } = await http.post<Medicine>(`/vet/medicines/${id}/approve`, {});
    return data;
  },

  async archive(id: string): Promise<Medicine> {
    const { data } = await http.post<Medicine>(`/vet/medicines/${id}/archive`, {});
    return data;
  },
};
