import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { mapWithConcurrency } from '@/shared/api/pagination';
import {
  inventoryApi,
  type CreateItemInput,
  type CreateMovementInput,
  type InventoryCategory,
  type InventoryItem,
  type StockMovement,
  type UpdateItemInput,
} from '../api/inventory.api';

export const inventoryKeys = {
  all: ['inventory'] as const,
  items: (farmId: string, category: InventoryCategory | 'ALL', includeArchived: boolean) =>
    ['inventory', 'items', farmId, category, { includeArchived }] as const,
  item: (id: string) => ['inventory', 'item', id] as const,
  movements: (itemId: string, page: number) => ['inventory', 'movements', itemId, page] as const,
  ledger: (farmId: string, category: InventoryCategory | 'ALL') => ['inventory', 'ledger', farmId, category] as const,
};

export function useInventoryItems(farmId: string, category?: InventoryCategory, includeArchived = false) {
  return useQuery({
    queryKey: inventoryKeys.items(farmId, category ?? 'ALL', includeArchived),
    queryFn: () =>
      inventoryApi.listAllItems({
        farmId,
        ...(category ? { category } : {}),
        includeArchived: includeArchived || undefined,
        sort: 'name',
      }),
  });
}

export function useInventoryItem(id: string) {
  return useQuery({ queryKey: inventoryKeys.item(id), queryFn: () => inventoryApi.getItem(id) });
}

export const MOVEMENTS_PAGE_SIZE = 20;

export function useItemMovements(itemId: string, page: number) {
  return useQuery({
    queryKey: inventoryKeys.movements(itemId, page),
    queryFn: () => inventoryApi.listMovements(itemId, { page, limit: MOVEMENTS_PAGE_SIZE }),
    placeholderData: (previous) => previous,
  });
}

export interface LedgerMovement extends StockMovement {
  item: Pick<InventoryItem, 'id' | 'name' | 'category' | 'unit'>;
}

export interface Ledger {
  movements: LedgerMovement[];
  itemCount: number;
  /** Some items or movement histories were cut at the safety limits. */
  truncated: boolean;
}

const LEDGER_MAX_ITEMS = 200;
const LEDGER_MAX_MOVEMENTS_PER_ITEM = 1_000;

/**
 * All stock movements of a farm, newest first. The API lists movements per
 * item only, so this walks the items (including archived ones, for history)
 * with a small concurrency limit. Used by expenses and reports.
 */
export function useLedger(farmId: string, category?: InventoryCategory) {
  return useQuery({
    queryKey: inventoryKeys.ledger(farmId, category ?? 'ALL'),
    staleTime: 60_000,
    queryFn: async (): Promise<Ledger> => {
      const items = await inventoryApi.listAllItems({
        farmId,
        ...(category ? { category } : {}),
        includeArchived: true,
        sort: 'name',
      });
      const selected = items.items.slice(0, LEDGER_MAX_ITEMS);
      let truncated = items.truncated || items.items.length > LEDGER_MAX_ITEMS;
      const histories = await mapWithConcurrency(selected, 4, async (item) => {
        const result = await inventoryApi.listAllMovements(item.id, LEDGER_MAX_MOVEMENTS_PER_ITEM);
        if (result.truncated) truncated = true;
        const summary = { id: item.id, name: item.name, category: item.category, unit: item.unit };
        return result.items.map((movement) => ({ ...movement, item: summary }));
      });
      const movements = histories.flat().sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
      return { movements, itemCount: selected.length, truncated };
    },
  });
}

export function useInvalidateInventory() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: inventoryKeys.all });
}

export function useCreateItem() {
  const invalidate = useInvalidateInventory();
  return useMutation({ mutationFn: (body: CreateItemInput) => inventoryApi.createItem(body), onSuccess: invalidate });
}

export function useUpdateItem() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateItemInput }) => inventoryApi.updateItem(id, body),
    onSuccess: invalidate,
  });
}

export function useOpenItem() {
  const invalidate = useInvalidateInventory();
  return useMutation({ mutationFn: (id: string) => inventoryApi.openItem(id), onSuccess: invalidate });
}

export function useArchiveItem() {
  const invalidate = useInvalidateInventory();
  return useMutation({ mutationFn: (id: string) => inventoryApi.archiveItem(id), onSuccess: invalidate });
}

/** The balance is computed by the server; the cache is refreshed from it afterwards. */
export function useCreateMovement() {
  const invalidate = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ itemId, body, idempotencyKey }: { itemId: string; body: CreateMovementInput; idempotencyKey: string }) =>
      inventoryApi.createMovement(itemId, body, idempotencyKey),
    onSuccess: invalidate,
  });
}
