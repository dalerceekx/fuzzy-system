import { Calculator, Coins, History, Minus, Package, Pencil, Plus, Trash2, TriangleAlert, Warehouse } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { Farm } from '@/features/farms/api/farms.api';
import type { InventoryItem } from '@/features/inventory/api/inventory.api';
import { ItemFormDialog } from '@/features/inventory/components/ItemFormDialog';
import { MovementDialog, type MovementIntent } from '@/features/inventory/components/MovementDialog';
import { RecentMovements } from '@/features/inventory/components/RecentMovements';
import { formatQuantity, UNIT_SHORT } from '@/features/inventory/lib/labels';
import { formatTotals, isLowStock, stockValue, totalsByUnit } from '@/features/inventory/lib/stock-math';
import { useArchiveItem, useInventoryItems, useLedger } from '@/features/inventory/model/inventory.queries';
import { errorMessage } from '@/shared/api/errors';
import { Decimal } from '@/shared/lib/decimal';
import { formatInteger, formatMoney } from '@/shared/lib/format';
import {
  Alert,
  AsyncContent,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  EmptyState,
  ErrorState,
  IconButton,
  Skeleton,
  StatCard,
  toast,
  type Column,
} from '@/shared/ui';

const RECENT_LIMIT = 8;

const isEmpty = (item: InventoryItem) => Decimal.parse(item.quantity)?.isZero() ?? true;

function StockBadge({ item }: { item: InventoryItem }) {
  if (isEmpty(item)) return <Badge tone="danger">Tugagan</Badge>;
  if (isLowStock(item)) return <Badge tone="warning">Kam qoldi</Badge>;
  return <Badge tone="success">Yetarli</Badge>;
}

/**
 * "Yem — omborni boshqarish": every feed with its balance, unit price and
 * value; intake, consumption, edit and delete (archive) with confirmation;
 * low-stock warnings from the farmer's minimums.
 */
export function FeedInventory({ farm }: { farm: Farm }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const items = useInventoryItems(farm.id, 'FEED');
  const feedItems = useMemo(() => items.data?.items ?? [], [items.data]);
  const ledger = useLedger(farm.id, 'FEED');
  const archive = useArchiveItem();
  const [movement, setMovement] = useState<{ item: InventoryItem; intent: MovementIntent } | null>(null);
  const [editing, setEditing] = useState<InventoryItem | null>(null);
  const [removing, setRemoving] = useState<InventoryItem | null>(null);
  const creating = params.get('new') === '1';

  function setCreating(open: boolean): void {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (open) next.set('new', '1');
      else next.delete('new');
      return next;
    });
  }

  const lowItems = feedItems.filter((item) => isLowStock(item));
  let totalValue = Decimal.ZERO;
  let unpriced = 0;
  for (const item of feedItems) {
    const value = stockValue(item);
    if (value) totalValue = totalValue.add(value);
    else unpriced += 1;
  }

  const columns: Column<InventoryItem>[] = [
    { key: 'name', header: 'Yem nomi', cell: (item) => <span className="font-semibold">{item.name}</span> },
    { key: 'quantity', header: 'Miqdori', align: 'right', cell: (item) => formatQuantity(item.quantity, item.unit) },
    {
      key: 'price',
      header: '1 kg narxi',
      align: 'right',
      cell: (item) => (item.unitPrice ? `${formatMoney(item.unitPrice)}/${UNIT_SHORT[item.unit]}` : '—'),
    },
    {
      key: 'value',
      header: 'Qiymati',
      align: 'right',
      cell: (item) => {
        const value = stockValue(item);
        return value ? formatMoney(value) : '—';
      },
    },
    { key: 'status', header: 'Holat', cell: (item) => <StockBadge item={item} /> },
    {
      key: 'actions',
      header: <span className="sr-only">Amallar</span>,
      align: 'right',
      mobileFooter: true,
      cell: (item) => (
        <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
          <Button
            size="sm"
            icon={<Plus aria-hidden className="size-4" />}
            onClick={() => setMovement({ item, intent: 'purchase' })}
          >
            Kirim
          </Button>
          <Button
            size="sm"
            variant="secondary"
            icon={<Minus aria-hidden className="size-4" />}
            onClick={() => setMovement({ item, intent: 'consumption' })}
            disabled={isEmpty(item)}
          >
            Sarf
          </Button>
          <IconButton
            label={`${item.name}: tahrirlash`}
            icon={<Pencil aria-hidden className="size-4" />}
            onClick={() => setEditing(item)}
          />
          <IconButton
            label={`${item.name}: o‘chirish`}
            icon={<Trash2 aria-hidden className="size-4" />}
            onClick={() => setRemoving(item)}
          />
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Compact cards: 2 × 2 on a phone, one row on a wide screen. */}
      <section aria-label="Yem ombori ko‘rsatkichlari" className="grid grid-cols-2 gap-2.5 lg:grid-cols-4 lg:gap-4">
        <StatCard
          compact
          icon={<Package className="size-5" />}
          label="Yem turlari"
          value={formatInteger(feedItems.length)}
          loading={items.isPending}
          failed={items.isError}
        />
        <StatCard
          compact
          icon={<Warehouse className="size-5" />}
          label="Umumiy qoldiq"
          value={formatTotals(totalsByUnit(feedItems))}
          loading={items.isPending}
          failed={items.isError}
        />
        <StatCard
          compact
          icon={<Coins className="size-5" />}
          label="Ombor qiymati"
          value={formatMoney(totalValue)}
          secondary={unpriced > 0 ? `${unpriced} ta narxsiz` : undefined}
          loading={items.isPending}
          failed={items.isError}
        />
        <StatCard
          compact
          icon={<TriangleAlert className="size-5" />}
          label="Kam qolgan yemlar"
          value={formatInteger(lowItems.length)}
          loading={items.isPending}
          failed={items.isError}
        />
      </section>

      {lowItems.length > 0 ? (
        <Alert tone="warning" title={`${lowItems.length} ta yem kam qoldi`}>
          <ul className="mt-1 flex flex-col gap-0.5">
            {lowItems.map((item) => (
              <li key={item.id}>
                {item.name}: <strong className="tabular">{formatQuantity(item.quantity, item.unit)}</strong>
                {item.minQuantity ? ` (minimal ${formatQuantity(item.minQuantity, item.unit)})` : ''}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <Card>
        <CardHeader
          title="Yem mahsulotlari"
          description={`Ferma: ${farm.name}`}
          icon={<Warehouse className="size-5" />}
          actions={
            <>
              <ButtonLink to="/feed-calculator" variant="secondary" icon={<Calculator aria-hidden className="size-5" />}>
                Ratsion hisoblash
              </ButtonLink>
              <Button icon={<Plus aria-hidden className="size-5" />} onClick={() => setCreating(true)}>
                Yem qo‘shish
              </Button>
            </>
          }
        />
        <AsyncContent
          query={items}
          collection
          isEmpty={() => feedItems.length === 0}
          empty={
            <EmptyState
              title="Omborda hali yem yo‘q"
              description="Yem nomi, miqdori va 1 kg narxini kiriting — istalgancha yem turi qo‘shish mumkin."
              action={
                <Button icon={<Plus aria-hidden className="size-5" />} onClick={() => setCreating(true)}>
                  Yem qo‘shish
                </Button>
              }
            />
          }
        >
          {() => (
            <DataTable
              caption="Yem mahsulotlari"
              columns={columns}
              rows={feedItems}
              rowKey={(item) => item.id}
              onRowClick={(item) => navigate(`/feed/${item.id}`)}
            />
          )}
        </AsyncContent>
      </Card>

      <Card>
        <CardHeader title="Yaqindagi ombor harakatlari" icon={<History className="size-5" />} />
        {ledger.isError ? (
          <ErrorState error={ledger.error} collection onRetry={() => void ledger.refetch()} />
        ) : ledger.isPending ? (
          <div className="flex flex-col gap-3 p-5">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        ) : (
          <RecentMovements movements={ledger.data.movements.slice(0, RECENT_LIMIT)} />
        )}
      </Card>

      <ItemFormDialog open={creating} onClose={() => setCreating(false)} farmId={farm.id} category="FEED" />
      <ItemFormDialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        farmId={farm.id}
        category="FEED"
        item={editing}
        onAdjustQuantity={() => editing && setMovement({ item: editing, intent: 'adjustment' })}
      />
      {movement ? <MovementDialog item={movement.item} intent={movement.intent} onClose={() => setMovement(null)} /> : null}
      <ConfirmDialog
        open={removing !== null}
        title={`“${removing?.name ?? ''}”ni o‘chirish`}
        message="Yem ombor ro‘yxatidan olinadi. Kirim va sarf tarixi saqlanib qoladi."
        confirmLabel="O‘chirish"
        loading={archive.isPending}
        error={archive.error ? errorMessage(archive.error) : null}
        onCancel={() => {
          setRemoving(null);
          archive.reset();
        }}
        onConfirm={() => {
          if (!removing || archive.isPending) return;
          archive.mutate(removing.id, {
            onSuccess: () => {
              toast.success(`“${removing.name}” o‘chirildi`);
              setRemoving(null);
            },
          });
        }}
      />
    </div>
  );
}
