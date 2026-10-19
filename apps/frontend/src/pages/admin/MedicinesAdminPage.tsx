import { Archive, BadgeCheck, Pill, Plus } from 'lucide-react';
import { useState } from 'react';
import { useCurrentUser } from '@/features/auth/hooks/useCurrentUser';
import { can } from '@/features/auth/lib/permissions';
import type { Medicine, MedicineStatus } from '@/features/medicines/api/medicines.api';
import { MedicineCatalogTable } from '@/features/medicines/components/MedicineCatalogTable';
import { MedicineFormDialog } from '@/features/medicines/components/MedicineFormDialog';
import { useApproveMedicine, useArchiveMedicine, useMedicineCatalog } from '@/features/medicines/model/medicines.queries';
import { errorMessage } from '@/shared/api/errors';
import { AsyncContent, Button, Card, CardHeader, ConfirmDialog, EmptyState, SegmentedTabs, toast } from '@/shared/ui';

type Filter = 'ALL' | MedicineStatus;

export default function MedicinesAdminPage() {
  const { data: me } = useCurrentUser();
  const catalog = useMedicineCatalog();
  const approve = useApproveMedicine();
  const archive = useArchiveMedicine();
  const [filter, setFilter] = useState<Filter>('ALL');
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState<{ medicine: Medicine; action: 'approve' | 'archive' } | null>(null);

  if (!me) return null;
  const canManage = can.manageMedicines(me.role);
  const canApprove = can.approveMedicines(me.role);
  const current = pending?.action === 'approve' ? approve : archive;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <SegmentedTabs<Filter>
          label="Holat bo‘yicha"
          value={filter}
          onChange={setFilter}
          tabs={[
            { value: 'ALL', label: 'Barchasi' },
            { value: 'DRAFT', label: 'Qoralama' },
            { value: 'APPROVED', label: 'Tasdiqlangan' },
            { value: 'ARCHIVED', label: 'Arxiv' },
          ]}
        />
        {canManage ? (
          <Button icon={<Plus aria-hidden className="size-5" />} onClick={() => setCreating(true)}>
            Dori qo‘shish
          </Button>
        ) : null}
      </div>

      <Card>
        <CardHeader
          title="Dorilar katalogi"
          description={canApprove ? 'Qoralamalarni tekshirib tasdiqlang' : 'Tasdiqlash faqat veterinar uchun'}
          icon={<Pill className="size-5" />}
        />
        <AsyncContent
          query={catalog}
          collection
          isEmpty={(data) => data.filter((medicine) => filter === 'ALL' || medicine.status === filter).length === 0}
          empty={<EmptyState title="Bu holatda dori yo‘q" />}
        >
          {(data) => (
            <MedicineCatalogTable
              medicines={data.filter((medicine) => filter === 'ALL' || medicine.status === filter)}
              actions={
                canManage || canApprove
                  ? (medicine) => (
                      <div className="flex justify-end gap-1.5">
                        {canApprove && medicine.status === 'DRAFT' && !medicine.isDemo ? (
                          <Button
                            size="sm"
                            icon={<BadgeCheck aria-hidden className="size-4" />}
                            onClick={() => setPending({ medicine, action: 'approve' })}
                          >
                            Tasdiqlash
                          </Button>
                        ) : null}
                        {canManage && medicine.status !== 'ARCHIVED' ? (
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={<Archive aria-hidden className="size-4" />}
                            onClick={() => setPending({ medicine, action: 'archive' })}
                          >
                            Arxivlash
                          </Button>
                        ) : null}
                      </div>
                    )
                  : undefined
              }
            />
          )}
        </AsyncContent>
      </Card>

      <MedicineFormDialog open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog
        open={pending !== null}
        title={pending?.action === 'approve' ? 'Dorini tasdiqlash' : 'Dorini arxivlash'}
        message={
          pending?.action === 'approve'
            ? `“${pending.medicine.name}” tasdiqlangach, uning klinik ma’lumotlarini o‘zgartirib bo‘lmaydi va u fermerlarga ko‘rinadi.`
            : `“${pending?.medicine.name ?? ''}” katalogdan olinadi.`
        }
        confirmLabel={pending?.action === 'approve' ? 'Tasdiqlash' : 'Arxivlash'}
        tone={pending?.action === 'approve' ? 'primary' : 'danger'}
        loading={current.isPending}
        error={current.error ? errorMessage(current.error) : null}
        onCancel={() => {
          setPending(null);
          approve.reset();
          archive.reset();
        }}
        onConfirm={() => {
          if (!pending || current.isPending) return;
          const onSuccess = () => {
            toast.success(pending.action === 'approve' ? 'Dori tasdiqlandi' : 'Dori arxivlandi');
            setPending(null);
          };
          if (pending.action === 'approve') approve.mutate(pending.medicine.id, { onSuccess });
          else archive.mutate(pending.medicine.id, { onSuccess });
        }}
      />
    </div>
  );
}
