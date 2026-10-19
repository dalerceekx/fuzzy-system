import { Pill, Plus } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import type { Farm } from '@/features/farms/api/farms.api';
import type { InventoryItem } from '@/features/inventory/api/inventory.api';
import { ItemFormDialog } from '@/features/inventory/components/ItemFormDialog';
import { effectiveExpiry, EXPIRY_LABELS, expiryStatus } from '@/features/inventory/lib/expiry';
import { formatQuantity } from '@/features/inventory/lib/labels';
import { useInventoryItems } from '@/features/inventory/model/inventory.queries';
import { formatDate } from '@/shared/lib/format';
import { AsyncContent, Badge, Button, Card, CardHeader, DataTable, EmptyState, type Column } from '@/shared/ui';
import { useMedicineCatalog } from '../model/medicines.queries';

/** Medicine bottles/vials in the farm warehouse (inventory items of category MEDICINE). */
export function MedicineStock({ farm }: { farm: Farm }) {
  const navigate = useNavigate();
  const items = useInventoryItems(farm.id, 'MEDICINE');
  const catalog = useMedicineCatalog();
  const [creating, setCreating] = useState(false);
  const medicineNames = useMemo(
    () => new Map((catalog.data ?? []).map((medicine) => [medicine.id, medicine.name])),
    [catalog.data],
  );

  const columns: Column<InventoryItem>[] = [
    {
      key: 'name',
      header: 'Nomi',
      cell: (item) => (
        <div className="flex flex-col">
          <span className="font-semibold">{item.name}</span>
          {item.medicineId ? (
            <span className="text-[13px] text-ink-secondary">Katalog: {medicineNames.get(item.medicineId) ?? 'bog‘langan'}</span>
          ) : null}
        </div>
      ),
    },
    { key: 'batch', header: 'Partiya', hideOnMobile: true, cell: (item) => item.batchNumber ?? '—' },
    { key: 'quantity', header: 'Qoldiq', align: 'right', cell: (item) => formatQuantity(item.quantity, item.unit) },
    {
      key: 'expiry',
      header: 'Yaroqlilik',
      cell: (item) => {
        const status = expiryStatus(item);
        if (status === 'NONE') return '—';
        return (
          <span className="flex flex-col items-start gap-0.5">
            <Badge tone={status === 'OK' ? 'success' : status === 'SOON' ? 'warning' : 'danger'}>{EXPIRY_LABELS[status]}</Badge>
            <span className="text-[13px] text-ink-secondary">{formatDate(effectiveExpiry(item))} gacha</span>
          </span>
        );
      },
    },
    {
      key: 'opened',
      header: 'Ochilgan',
      hideOnMobile: true,
      cell: (item) => (item.openedAt ? formatDate(item.openedAt) : 'Yo‘q'),
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Ombordagi dorilar"
        description="Shisha, flakon va boshqa idishlar qoldig‘i"
        icon={<Pill className="size-5" />}
        actions={
          <Button icon={<Plus aria-hidden className="size-5" />} onClick={() => setCreating(true)}>
            Dori qo‘shish
          </Button>
        }
      />
      <AsyncContent
        query={items}
        collection
        isEmpty={(data) => data.items.length === 0}
        empty={<EmptyState title="Omborda dori yo‘q" description="Dori idishini qo‘shing, so‘ng kirim qiling." />}
      >
        {(data) => (
          <DataTable
            caption="Ombordagi dorilar"
            columns={columns}
            rows={data.items}
            rowKey={(item) => item.id}
            onRowClick={(item) => navigate(`/medicines/stock/${item.id}`)}
          />
        )}
      </AsyncContent>
      <ItemFormDialog open={creating} onClose={() => setCreating(false)} farmId={farm.id} category="MEDICINE" />
    </Card>
  );
}
