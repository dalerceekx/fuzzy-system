import { ArrowLeft, Copy, Eye, PawPrint, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useFarmAnimals } from '@/features/animals/model/animals.queries';
import type { Farm } from '@/features/farms/api/farms.api';
import { errorMessage } from '@/shared/api/errors';
import { formatDate, formatInteger, formatMoney } from '@/shared/lib/format';
import {
  AsyncContent,
  Badge,
  Button,
  ButtonLink,
  Card,
  CardBody,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageLoader,
  toast,
} from '@/shared/ui';
import type { Ration } from '../api/rations.api';
import { belongsToType, PROFILE_HINTS, PURPOSE_LABELS } from '../lib/labels';
import { summarizeRation } from '../lib/ration-math';
import { useArchiveAnimalType, useArchiveRation, useAnimalTypes, useCopyRation, useRations } from '../model/rations.queries';

function RationRow({ ration, onCopy, onRemove }: { ration: Ration; onCopy: () => void; onRemove: () => void }) {
  const summary = summarizeRation(ration);
  return (
    <li className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center">
      <div className="min-w-0 flex-1">
        <Link to={`/feed-calculator/rations/${ration.id}`} className="font-semibold text-ink hover:underline">
          {ration.name}
        </Link>
        <p className="text-[13px] text-ink-secondary">
          {formatInteger(ration.animalCount)} bosh · {formatInteger(ration.days)} kun · {PURPOSE_LABELS[ration.purpose]} ·{' '}
          {ration.items.length} xil yem · {formatDate(ration.updatedAt)}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
          <span className="tabular">Kunlik: {formatMoney(summary.dailyCost)}</span>
          {summary.sufficient ? <Badge tone="success">Ombor yetarli</Badge> : <Badge tone="danger">Ombor yetarli emas</Badge>}
        </p>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <ButtonLink to={`/feed-calculator/rations/${ration.id}`} size="sm" icon={<Eye aria-hidden className="size-4" />}>
          Ochish
        </ButtonLink>
        <Button size="sm" variant="secondary" icon={<Copy aria-hidden className="size-4" />} onClick={onCopy}>
          Nusxalash
        </Button>
        <Button size="sm" variant="ghost" icon={<Trash2 aria-hidden className="size-4" />} onClick={onRemove}>
          O‘chirish
        </Button>
      </div>
    </li>
  );
}

/** One animal category: its saved rations (reuse, copy, delete) and "Yangi ratsion". */
export function AnimalTypeRations({ farm, typeId }: { farm: Farm; typeId: string }) {
  const navigate = useNavigate();
  const types = useAnimalTypes(farm.id);
  const rations = useRations(farm.id, typeId);
  const animals = useFarmAnimals(farm.id);
  const copy = useCopyRation();
  const archive = useArchiveRation();
  const archiveType = useArchiveAnimalType();
  const [removing, setRemoving] = useState<Ration | null>(null);
  const [removingType, setRemovingType] = useState(false);

  const back = (
    <div>
      <ButtonLink to="/feed-calculator" variant="ghost" size="sm" icon={<ArrowLeft aria-hidden className="size-4" />}>
        Hayvon turlari
      </ButtonLink>
    </div>
  );

  if (types.isPending) return <PageLoader />;
  if (types.isError) {
    return (
      <Card>
        <ErrorState error={types.error} collection onRetry={() => void types.refetch()} />
      </Card>
    );
  }
  const type = types.data.find((candidate) => candidate.id === typeId);
  if (!type) {
    return (
      <div className="flex flex-col gap-5">
        {back}
        <Card>
          <EmptyState title="Hayvon turi topilmadi" description="U o‘chirilgan yoki boshqa fermaga tegishli." />
        </Card>
      </div>
    );
  }
  const herd = (animals.data?.items ?? []).filter((animal) => belongsToType(animal, type)).length;
  const newRationLink = `/feed-calculator/types/${type.id}/new`;

  return (
    <div className="flex flex-col gap-5">
      {back}
      <Card>
        <CardHeader
          title={type.name}
          description={PROFILE_HINTS[type.profile]}
          icon={<PawPrint className="size-5" />}
          actions={
            <>
              {type.isDefault ? null : (
                <Button
                  variant="ghost"
                  size="sm"
                  icon={<Trash2 aria-hidden className="size-4" />}
                  onClick={() => setRemovingType(true)}
                >
                  Turni o‘chirish
                </Button>
              )}
              <ButtonLink to={newRationLink} icon={<Plus aria-hidden className="size-5" />}>
                Yangi ratsion
              </ButtonLink>
            </>
          }
        />
        <CardBody>
          <p className="text-ink-secondary">
            Fermada: <strong className="text-ink">{formatInteger(herd)} bosh</strong> · har bir ratsion alohida hisoblanadi va
            istalgan vaqtda qayta ishlatiladi.
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Saqlangan ratsionlar" />
        <AsyncContent
          query={rations}
          collection
          isEmpty={(data) => data.items.length === 0}
          empty={
            <EmptyState
              title="Bu tur uchun hali ratsion yo‘q"
              description="Hayvonlar soni, muddat va ombordagi yemlardan ratsion tuzing."
              action={
                <ButtonLink to={newRationLink} icon={<Plus aria-hidden className="size-5" />}>
                  Yangi ratsion
                </ButtonLink>
              }
            />
          }
        >
          {(data) => (
            <ul aria-label={`${type.name} ratsionlari`} className="divide-y divide-line">
              {data.items.map((ration) => (
                <RationRow
                  key={ration.id}
                  ration={ration}
                  onCopy={() =>
                    copy.mutate(ration.id, {
                      onSuccess: (created) => {
                        toast.success(`Nusxa yaratildi: “${created.name}”`);
                        navigate(`/feed-calculator/rations/${created.id}`);
                      },
                      onError: (error) => toast.error(errorMessage(error)),
                    })
                  }
                  onRemove={() => setRemoving(ration)}
                />
              ))}
            </ul>
          )}
        </AsyncContent>
      </Card>

      <ConfirmDialog
        open={removing !== null}
        title={`“${removing?.name ?? ''}” ratsionini o‘chirish`}
        message="Ratsion ro‘yxatdan olinadi. Ombordan chiqarilgan sarf tarixi saqlanib qoladi."
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
              toast.success('Ratsion o‘chirildi');
              setRemoving(null);
            },
          });
        }}
      />
      <ConfirmDialog
        open={removingType}
        title={`“${type.name}” turini o‘chirish`}
        message="Faqat ratsionlari qolmagan tur o‘chiriladi."
        confirmLabel="O‘chirish"
        loading={archiveType.isPending}
        error={archiveType.error ? errorMessage(archiveType.error) : null}
        onCancel={() => {
          setRemovingType(false);
          archiveType.reset();
        }}
        onConfirm={() => {
          if (archiveType.isPending) return;
          archiveType.mutate(type.id, {
            onSuccess: () => {
              toast.success('Hayvon turi o‘chirildi');
              navigate('/feed-calculator');
            },
          });
        }}
      />
    </div>
  );
}
