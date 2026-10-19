import { Layers, PawPrint } from 'lucide-react';
import { Link } from 'react-router';
import { SPECIES_LABELS } from '@/features/animals/lib/labels';
import { useAnimalCounts } from '@/features/animals/model/animals.queries';
import { RequireFarm } from '@/features/farms/components/RequireFarm';
import type { Farm } from '@/features/farms/api/farms.api';
import { formatInteger } from '@/shared/lib/format';
import { Alert, Card, CardBody, CardHeader, ErrorState, GapState, Skeleton } from '@/shared/ui';

function SpeciesGroups({ farm }: { farm: Farm }) {
  const counts = useAnimalCounts(farm.id);
  const groups = counts.bySpecies.filter((group) => group.count > 0);

  return (
    <div className="flex flex-col gap-6">
      <Alert tone="info" title="Guruhlar hozircha avtomatik">
        Backend’da qo‘lda guruh yaratish (nom, yosh toifasi, a’zolar) hali yo‘q. Quyida hayvonlar turi bo‘yicha avtomatik
        guruhlangan — sonlar serverdan olingan aniq qiymatlar.
      </Alert>

      <Card>
        <CardHeader title="Tur bo‘yicha guruhlar" description={`Ferma: ${farm.name}`} icon={<Layers className="size-5" />} />
        <CardBody>
          {counts.error ? (
            <ErrorState error={counts.error} collection onRetry={counts.refetch} />
          ) : counts.isPending ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} className="h-24" />
              ))}
            </div>
          ) : groups.length === 0 ? (
            <p className="py-6 text-center text-ink-secondary">Hali hayvon yo‘q, shuning uchun guruhlar ham yo‘q.</p>
          ) : (
            <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {groups.map((group) => (
                <li key={group.species}>
                  <Link
                    to={`/animals?species=${group.species}`}
                    className="flex items-center gap-4 rounded-[12px] border border-line px-4 py-4 transition-colors hover:border-primary-hover hover:bg-primary-light/40"
                  >
                    <span aria-hidden className="inline-flex size-11 items-center justify-center rounded-[12px] bg-primary-light">
                      <PawPrint className="size-5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold text-ink">{SPECIES_LABELS[group.species]}</span>
                      <span className="block text-sm text-ink-secondary">Hayvonlarni ko‘rish</span>
                    </span>
                    <span className="text-2xl font-semibold tabular">{formatInteger(group.count)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <GapState
          title="Qo‘lda guruh yaratish hali backend’da mavjud emas"
          description="Masalan “Sog‘in sigirlar” yoki “Bo‘rdoqidagi buqachalar” kabi guruhlar API qo‘shilgach shu yerda yaratiladi."
        />
      </Card>
    </div>
  );
}

export default function AnimalGroupsPage() {
  return <RequireFarm>{(farm) => <SpeciesGroups key={farm.id} farm={farm} />}</RequireFarm>;
}
