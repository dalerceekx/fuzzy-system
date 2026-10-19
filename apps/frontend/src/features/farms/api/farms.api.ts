import { http } from '@/shared/api/client';
import { cleanParams, fetchAllPages } from '@/shared/api/pagination';
import type { PageQuery, Paginated } from '@/shared/types/api';

/** /api/v1/farms — FARMER only, scoped to the owner (CONTRACT §7.1). */
export interface Farm {
  id: string;
  name: string;
  region: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface FarmInput {
  name: string;
  region?: string;
}

export const farmsApi = {
  async list(query: PageQuery = {}): Promise<Paginated<Farm>> {
    const { data } = await http.get<Paginated<Farm>>('/farms', { params: cleanParams({ ...query }) });
    return data;
  },

  async listAll(): Promise<Farm[]> {
    const result = await fetchAllPages((page, limit) => farmsApi.list({ page, limit, sort: 'name' }), 500);
    return result.items;
  },

  async create(body: FarmInput): Promise<Farm> {
    const { data } = await http.post<Farm>('/farms', body);
    return data;
  },

  async update(id: string, body: Partial<FarmInput>): Promise<Farm> {
    const { data } = await http.patch<Farm>(`/farms/${id}`, body);
    return data;
  },

  async archive(id: string): Promise<Farm> {
    const { data } = await http.post<Farm>(`/farms/${id}/archive`, {});
    return data;
  },
};
