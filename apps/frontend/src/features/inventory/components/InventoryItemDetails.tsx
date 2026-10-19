import { Archive, ArrowLeft, History, Minus, PackageOpen, Pencil, Plus, Scale, ShoppingCart } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { errorMessage } from '@/shared/api/errors';
import { Decimal } from '@/shared/lib/decimal';
import { formatDate, formatDateTime, formatMoney } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';
import {
  Alert,
  AsyncContent,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  DataTable,
  DescriptionList,
  EmptyState,
  Pagination,
  toast,
  type Column,
} from '@/shared/ui';
import type { InventoryItem, StockMovement } from '../api/inventory.api';
import { CATEGORY_LABELS, formatQuantity, isIncoming, MOVEMENT_LABELS, UNIT_NAMES, UNIT_SHORT } from '../lib/labels';
import { expiryStatus, EXPIRY_LABELS } from '../lib/expiry';
import { isLowStock } from '../lib/stock-math';
import { MOVEMENTS_PAGE_SIZE, useArchiveItem, useInventoryItem, useItemMovements, useOpenItem } from '../model/inventory.queries';
import { ItemFormDialog } from './ItemFormDialog';
import { MovementDialog, type MovementIntent } from './MovementDialog';

function MovementHistory({ item }: { item: InventoryItem }) {
  const [page, setPage] = useState(1);
  const movements = useItemMovements(item.id, page);
  const columns: Column<StockMovement>[] = [
    { key: 'date', header: 'Sana', cell: (movement) => formatDateTime(movement.createdAt) },
    {
      key: 'type',
      header: 'Turi',
      cell: (movement) => (
        <Badge tone={isIncoming(movement.type) ? 'success' : 'warning'}>{MOVEMENT_LABELS[movement.type]}</Badge>
      ),
    },
    {
      key: 'quantity',
      header: 'Miqdor',
      align: 'right',
      cell: (movement) => (
        <span className={cn('font-semibold', isIncoming(movement.type) ? 'text-success' : 'text-ink')}>
          {isIncoming(movement.type) ? '+' : '−'}
          {formatQuantity(movement.quantity, item.unit)}
        </span>
      ),
    },
    { key: 'balance', header: 'Qoldiq', align: 'right', cell: (movement) => formatQuantity(movement.balanceAfter, item.unit) },
    {
      key: 'price',
      header: 'Narxi',
      align: 'right',
      hideOnMobile: true,
      cell: (movement) => (movement.unitCost ? formatMoney(movement.unitCost) : '—'),
    },
    {
      key: 'sum',
      header: 'Summa',
      align: 'right',
      cell: (movement) =>
        movement.unitCost ? formatMoney(Decimal.from(movement.quantity).mul(Decimal.from(movement.unitCost))) : '—',
    },
    { key: 'reason', header: 'Izoh', hideOnMobile: true, cell: (movement) => movement.reason ?? '—' },
  ];
  return (
    <AsyncContent
      query={movements}
      collection
      isEmpty={(data) => data.items.length === 0}
      empty={<EmptyState title="Hali harakatlar yo‘q" description="Birinchi kirimni kiriting." />}
    >
      {(data) => (
        <>
          <DataTable caption="Ombor harakatlari tarixi" columns={columns} rows={data.items} rowKey={(movement) => movement.id} />
          <Pagination page={data.page} limit={MOVEMENTS_PAGE_SIZE} total={data.total} onPageChange={setPage} />
        </>
      )}
    </AsyncContent>
  );
}

export function InventoryItemDetails({ itemId, backTo, backLabel }: { itemId: string; backTo: string; backLabel: string }) {
  const navigate = useNavigate();
  const item = useInventoryItem(itemId);
  const openItem = useOpenItem();
  const archive = useArchiveItem();
  const [movement, setMovement] = useState<MovementIntent | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirm, setConfirm] = useState<'open' | 'archive' | null>(null);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <ButtonLink to={backTo} variant="ghost" size="sm" icon={<ArrowLeft aria-hidden className="size-4" />}>
          {backLabel}
        </ButtonLink>
      </div>
      <AsyncContent query={item}>
        {(data) => {
          const empty = Decimal.parse(data.quantity)?.isZero() ?? true;
          const expiry = expiryStatus(data);
          return (
            <>
              <Card>
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {data.name}
                      {data.archivedAt ? <Badge tone="neutral">Arxivda</Badge> : null}
                    </span>
                  }
                  description={`${CATEGORY_LABELS[data.category]} · ${UNIT_NAMES[data.unit]}`}
                  icon={<Scale className="size-5" />}
                  actions={
                    data.archivedAt ? null : (
                      <>
                        <Button icon={<ShoppingCart aria-hidden className="size-4" />} onClick={() => setMovement('purchase')}>
                          Xarid
                        </Button>
                        <Button
                          variant="secondary"
                          icon={<Plus aria-hidden className="size-4" />}
                          onClick={() => setMovement('intake')}
                        >
                          Kirim
                        </Button>
                        <Button
                          variant="secondary"
                          icon={<Minus aria-hidden className="size-4" />}
                          disabled={empty}
                          onClick={() => setMovement('consumption')}
                        >
                          Sarflash
                        </Button>
                      </>
                    )
                  }
                />
                <CardBody className="flex flex-col gap-5">
                  <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
                    <div>
                      <p className="text-sm text-ink-secondary">Hozirgi qoldiq</p>
                      <p className="text-3xl font-semibold tabular">{formatQuantity(data.quantity, data.unit)}</p>
                    </div>
                    {!data.archivedAt && isLowStock(data) ? (
                      <Badge tone={empty ? 'danger' : 'warning'}>{empty ? 'Tugagan' : 'Kam qoldi'}</Badge>
                    ) : null}
                    {expiry !== 'NONE' ? (
                      <Badge tone={expiry === 'OK' ? 'success' : expiry === 'SOON' ? 'warning' : 'danger'}>
                        {EXPIRY_LABELS[expiry]}
                      </Badge>
                    ) : null}
                  </div>
                  {expiry === 'EXPIRED' ? (
                    <Alert tone="danger" title="Muddati o‘tgan" urgent>
                      Bu mahsulotni ishlatmang. Qoldiqni “Tuzatish” orqali hisobdan chiqaring.
                    </Alert>
                  ) : null}
                  <DescriptionList
                    items={[
                      {
                        label: `1 ${UNIT_SHORT[data.unit]} narxi`,
                        value: data.unitPrice ? formatMoney(data.unitPrice) : 'Kiritilmagan',
                      },
                      {
                        label: 'Minimal qoldiq',
                        value: data.minQuantity ? formatQuantity(data.minQuantity, data.unit) : 'Belgilanmagan',
                      },
                      { label: 'Partiya', value: data.batchNumber ?? '—' },
                      { label: 'Yaroqlilik muddati', value: formatDate(data.expiresOn) },
                      { label: 'Ochilgan', value: data.openedAt ? formatDateTime(data.openedAt) : 'Ochilmagan' },
                      {
                        label: 'Ochilgandan keyin',
                        value: data.useWithinDaysAfterOpening ? `${data.useWithinDaysAfterOpening} kun ichida` : '—',
                      },
                      { label: 'Yaratilgan', value: formatDateTime(data.createdAt) },
                      { label: 'Yangilangan', value: formatDateTime(data.updatedAt) },
                    ]}
                  />
                  {data.archivedAt ? null : (
                    <div className="flex flex-wrap gap-2 border-t border-line pt-4">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Scale aria-hidden className="size-4" />}
                        onClick={() => setMovement('adjustment')}
                      >
                        Inventarizatsiya tuzatishi
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Pencil aria-hidden className="size-4" />}
                        onClick={() => setEditing(true)}
                      >
                        Tahrirlash
                      </Button>
                      {data.category === 'MEDICINE' && !data.openedAt ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          icon={<PackageOpen aria-hidden className="size-4" />}
                          onClick={() => setConfirm('open')}
                        >
                          Idish ochildi
                        </Button>
                      ) : null}
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Archive aria-hidden className="size-4" />}
                        onClick={() => setConfirm('archive')}
                      >
                        Arxivlash
                      </Button>
                    </div>
                  )}
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title="Harakatlar tarixi"
                  description="Server hisoblagan qoldiq bilan"
                  icon={<History className="size-5" />}
                />
                <MovementHistory item={data} />
              </Card>

              {movement ? <MovementDialog item={data} intent={movement} onClose={() => setMovement(null)} /> : null}
              <ItemFormDialog
                open={editing}
                onClose={() => setEditing(false)}
                farmId={data.farmId}
                category={data.category}
                item={data}
                onAdjustQuantity={() => setMovement('adjustment')}
              />
              <ConfirmDialog
                open={confirm !== null}
                title={confirm === 'open' ? 'Idish ochilganini belgilash' : 'Mahsulotni arxivlash'}
                message={
                  confirm === 'open'
                    ? 'Ochilgan sana bir marta belgilanadi va o‘zgartirib bo‘lmaydi.'
                    : 'Mahsulot ro‘yxatdan olinadi, harakatlar tarixi saqlanadi.'
                }
                confirmLabel={confirm === 'open' ? 'Ha, ochildi' : 'Arxivlash'}
                tone={confirm === 'open' ? 'primary' : 'danger'}
                loading={openItem.isPending || archive.isPending}
                error={
                  (confirm === 'open' ? openItem.error : archive.error)
                    ? errorMessage(confirm === 'open' ? openItem.error : archive.error)
                    : null
                }
                onCancel={() => {
                  setConfirm(null);
                  openItem.reset();
                  archive.reset();
                }}
                onConfirm={() => {
                  if (confirm === 'open') {
                    openItem.mutate(data.id, {
                      onSuccess: () => {
                        toast.success('Ochilgan sana belgilandi');
                        setConfirm(null);
                      },
                    });
                  } else {
                    archive.mutate(data.id, {
                      onSuccess: () => {
                        toast.success('Mahsulot arxivlandi');
                        setConfirm(null);
                        navigate(backTo);
                      },
                    });
                  }
                }}
              />
            </>
          );
        }}
      </AsyncContent>
    </div>
  );
}
