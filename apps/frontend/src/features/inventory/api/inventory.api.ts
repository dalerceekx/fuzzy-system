import { http } from '@/shared/api/client';
import { cleanParams, fetchAllPages, type AllPagesResult } from '@/shared/api/pagination';
import type { PageQuery, Paginated } from '@/shared/types/api';

/** Backend enums (prisma: InventoryCategory, InventoryUnit, StockMovementType). */
export const INVENTORY_CATEGORIES = ['FEED', 'MEDICINE', 'EQUIPMENT', 'OTHER'] as const;
export type InventoryCategory = (typeof INVENTORY_CATEGORIES)[number];

export const INVENTORY_UNITS = ['KG', 'G', 'L', 'ML', 'PIECE', 'DOSE'] as const;
export type InventoryUnit = (typeof INVENTORY_UNITS)[number];

export const MOVEMENT_TYPES = ['IN', 'OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT'] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export interface InventoryItem {
  id: string;
  farmId: string;
  name: string;
  category: InventoryCategory;
  unit: InventoryUnit;
  /** Decimal string (3 dp). Changes only through movements. */
  quantity: string;
  medicineId: string | null;
  batchNumber: string | null;
  /** 'YYYY-MM-DD' */
  expiresOn: string | null;
  openedAt: string | null;
  useWithinDaysAfterOpening: number | null;
  /** Current price of one unit (decimal string, 2 dp); updated by every priced purchase. */
  unitPrice: string | null;
  /** Low-stock threshold (decimal string, 3 dp): low when quantity ≤ minQuantity. */
  minQuantity: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StockMovement {
  id: string;
  itemId: string;
  farmId: string;
  type: MovementType;
  quantity: string;
  balanceAfter: string;
  /** Price per unit, decimal string (2 dp). */
  unitCost: string | null;
  currency: string | null;
  reason: string | null;
  actorId: string;
  /** Set on consumption written by a ration issue ("Sarfni ombordan chiqarish"). */
  rationIssueId: string | null;
  createdAt: string;
}

export interface InventoryListQuery extends PageQuery {
  farmId?: string;
  category?: InventoryCategory;
  includeArchived?: boolean;
}

export interface CreateItemInput {
  farmId: string;
  name: string;
  category: InventoryCategory;
  unit: InventoryUnit;
  medicineId?: string;
  batchNumber?: string;
  expiresOn?: string;
  useWithinDaysAfterOpening?: number;
  unitPrice?: string;
  minQuantity?: string;
  /** Recorded as one IN movement (priced with unitPrice) in the same transaction. */
  initialQuantity?: string;
}

/** Metadata only — stock never changes through PATCH. `null` clears an optional field. */
export interface UpdateItemInput {
  name?: string;
  batchNumber?: string | null;
  expiresOn?: string | null;
  useWithinDaysAfterOpening?: number | null;
  unitPrice?: string | null;
  minQuantity?: string | null;
}

export interface CreateMovementInput {
  type: MovementType;
  quantity: string;
  unitCost?: string;
  currency?: string;
  reason?: string;
}

/** /api/v1/inventory — FARMER only (CONTRACT §7.2). */
export const inventoryApi = {
  async listItems(query: InventoryListQuery): Promise<Paginated<InventoryItem>> {
    const { data } = await http.get<Paginated<InventoryItem>>('/inventory/items', { params: cleanParams({ ...query }) });
    return data;
  },

  listAllItems(query: Omit<InventoryListQuery, 'page' | 'limit'>): Promise<AllPagesResult<InventoryItem>> {
    return fetchAllPages((page, limit) => inventoryApi.listItems({ ...query, page, limit }), 1_000);
  },

  async getItem(id: string): Promise<InventoryItem> {
    const { data } = await http.get<InventoryItem>(`/inventory/items/${id}`);
    return data;
  },

  async createItem(body: CreateItemInput): Promise<InventoryItem> {
    const { data } = await http.post<InventoryItem>('/inventory/items', body);
    return data;
  },

  async updateItem(id: string, body: UpdateItemInput): Promise<InventoryItem> {
    const { data } = await http.patch<InventoryItem>(`/inventory/items/${id}`, body);
    return data;
  },

  async openItem(id: string): Promise<InventoryItem> {
    const { data } = await http.post<InventoryItem>(`/inventory/items/${id}/open`, {});
    return data;
  },

  async archiveItem(id: string): Promise<InventoryItem> {
    const { data } = await http.post<InventoryItem>(`/inventory/items/${id}/archive`, {});
    return data;
  },

  /**
   * Requires an Idempotency-Key: the same key + body is applied once even if
   * the request is retried; the stock balance is computed by the server.
   */
  async createMovement(itemId: string, body: CreateMovementInput, idempotencyKey: string): Promise<StockMovement> {
    const { data } = await http.post<StockMovement>(`/inventory/items/${itemId}/movements`, body, {
      headers: { 'Idempotency-Key': idempotencyKey },
    });
    return data;
  },

  async listMovements(itemId: string, query: PageQuery = {}): Promise<Paginated<StockMovement>> {
    const { data } = await http.get<Paginated<StockMovement>>(`/inventory/items/${itemId}/movements`, {
      params: cleanParams({ sort: '-createdAt', ...query }),
    });
    return data;
  },

  listAllMovements(itemId: string, maxItems = 1_000): Promise<AllPagesResult<StockMovement>> {
    return fetchAllPages((page, limit) => inventoryApi.listMovements(itemId, { page, limit }), maxItems);
  },
};
