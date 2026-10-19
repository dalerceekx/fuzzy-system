import { useState } from 'react';
import type { Farm } from '@/features/farms/api/farms.api';
import { INVENTORY_CATEGORIES, type InventoryItem } from '@/features/inventory/api/inventory.api';
import { MovementDialog } from '@/features/inventory/components/MovementDialog';
import { CATEGORY_LABELS } from '@/features/inventory/lib/labels';
import { useInventoryItems } from '@/features/inventory/model/inventory.queries';
import { AsyncContent, Button, ButtonLink, EmptyState, Field, Modal, Select } from '@/shared/ui';

/**
 * "Xarajat qo‘shish". The backend has no expenses module: spending is a stock
 * purchase, so the farmer picks the item and records the purchase with its
 * price (the same dialog as in the warehouse). It then shows up in the panel.
 */
export function AddExpenseDialog({ farm, onClose }: { farm: Farm; onClose: () => void }) {
  const items = useInventoryItems(farm.id);
  const [itemId, setItemId] = useState('');
  const [purchaseOf, setPurchaseOf] = useState<InventoryItem | null>(null);

  if (purchaseOf) return <MovementDialog item={purchaseOf} intent="purchase" onClose={onClose} />;

  const list = items.data?.items ?? [];
  const selected = list.find((item) => item.id === itemId) ?? list[0];

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Xarajat qo‘shish"
      description="Xarid omborga narxi bilan kiritiladi va xarajatlar ro‘yxatida avtomatik ko‘rinadi."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Bekor qilish
          </Button>
          <Button disabled={!selected} onClick={() => setPurchaseOf(selected ?? null)}>
            Davom etish
          </Button>
        </>
      }
    >
      <AsyncContent
        query={items}
        collection
        isEmpty={(data) => data.items.length === 0}
        empty={
          <EmptyState
            title="Omborda hali mahsulot yo‘q"
            description="Xarajat xarid sifatida yoziladi — avval omborga mahsulot qo‘shing."
            action={
              <ButtonLink to="/feed?new=1" variant="secondary">
                Yem qo‘shish
              </ButtonLink>
            }
          />
        }
      >
        {(data) => (
          <Field label="Nima sotib olindi?">
            <Select value={selected?.id ?? ''} onChange={(event) => setItemId(event.target.value)}>
              {INVENTORY_CATEGORIES.map((category) => {
                const options = data.items.filter((item) => item.category === category);
                return options.length > 0 ? (
                  <optgroup key={category} label={CATEGORY_LABELS[category]}>
                    {options.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </optgroup>
                ) : null;
              })}
            </Select>
          </Field>
        )}
      </AsyncContent>
    </Modal>
  );
}
