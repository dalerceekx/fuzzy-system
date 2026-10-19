import { Archive, CheckCircle2, Pencil, Plus, Tractor } from 'lucide-react';
import { useState } from 'react';
import type { Farm } from '@/features/farms/api/farms.api';
import { FarmFormDialog } from '@/features/farms/components/FarmFormDialog';
import { useActiveFarm, useArchiveFarm } from '@/features/farms/model/active-farm';
import { errorMessage } from '@/shared/api/errors';
import { formatDate } from '@/shared/lib/format';
import {
  AsyncContent,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DataTable,
  EmptyState,
  IconButton,
  toast,
  type Column,
} from '@/shared/ui';

export default function FarmsPage() {
  const { farmsQuery, activeFarm, setActiveFarm } = useActiveFarm();
  const archive = useArchiveFarm();
  const [dialog, setDialog] = useState<{ open: boolean; farm: Farm | null }>({ open: false, farm: null });
  const [archiving, setArchiving] = useState<Farm | null>(null);

  const columns: Column<Farm>[] = [
    {
      key: 'name',
      header: 'Nomi',
      cell: (farm) => (
        <span className="flex items-center gap-2 font-semibold">
          {farm.name}
          {farm.id === activeFarm?.id ? <Badge tone="primary">Faol</Badge> : null}
        </span>
      ),
    },
    { key: 'region', header: 'Hudud', cell: (farm) => farm.region ?? '—' },
    { key: 'created', header: 'Qo‘shilgan', cell: (farm) => formatDate(farm.createdAt) },
    {
      key: 'actions',
      header: <span className="sr-only">Amallar</span>,
      align: 'right',
      cell: (farm) => (
        <div className="flex justify-end gap-1">
          {farm.id !== activeFarm?.id && !farm.archivedAt ? (
            <Button
              variant="secondary"
              size="sm"
              icon={<CheckCircle2 aria-hidden className="size-4" />}
              onClick={() => setActiveFarm(farm.id)}
            >
              Tanlash
            </Button>
          ) : null}
          {farm.archivedAt ? (
            <Badge tone="neutral">Arxivda</Badge>
          ) : (
            <>
              <IconButton
                label={`${farm.name} ni tahrirlash`}
                icon={<Pencil aria-hidden className="size-4" />}
                onClick={() => setDialog({ open: true, farm })}
              />
              <IconButton
                label={`${farm.name} ni arxivlash`}
                icon={<Archive aria-hidden className="size-4" />}
                onClick={() => setArchiving(farm)}
              />
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <Card>
      <CardHeader
        title="Fermalarim"
        description="Har bir ferma bo‘yicha hayvonlar va ombor alohida yuritiladi."
        icon={<Tractor className="size-5" />}
        actions={
          <Button icon={<Plus aria-hidden className="size-5" />} onClick={() => setDialog({ open: true, farm: null })}>
            Ferma qo‘shish
          </Button>
        }
      />
      <AsyncContent
        query={farmsQuery}
        collection
        isEmpty={(farms) => farms.length === 0}
        empty={<EmptyState title="Hali ferma yo‘q" description="Birinchi fermangizni qo‘shing." />}
      >
        {(farms) => <DataTable caption="Fermalar" columns={columns} rows={farms} rowKey={(farm) => farm.id} />}
      </AsyncContent>

      <FarmFormDialog open={dialog.open} farm={dialog.farm} onClose={() => setDialog({ open: false, farm: null })} />
      <ConfirmDialog
        open={archiving !== null}
        title="Fermani arxivlash"
        message="Fermada faol hayvonlar yoki ombor mahsulotlari bo‘lsa, server arxivlashga ruxsat bermaydi. Avval ularni arxivlang."
        confirmLabel="Arxivlash"
        loading={archive.isPending}
        error={archive.error ? errorMessage(archive.error) : null}
        onCancel={() => {
          setArchiving(null);
          archive.reset();
        }}
        onConfirm={() => {
          if (!archiving || archive.isPending) return;
          archive.mutate(archiving.id, {
            onSuccess: () => {
              toast.success('Ferma arxivlandi');
              setArchiving(null);
            },
          });
        }}
      />
    </Card>
  );
}
