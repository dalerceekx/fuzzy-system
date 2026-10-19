import { ChevronRight, PawPrint, Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useFarmAnimals } from '@/features/animals/model/animals.queries';
import type { Farm } from '@/features/farms/api/farms.api';
import { formatInteger } from '@/shared/lib/format';
import { Alert, AsyncContent, Badge, Skeleton } from '@/shared/ui';
import type { AnimalType } from '../api/rations.api';
import { belongsToType, PROFILE_HINTS } from '../lib/labels';
import { useAnimalTypes, useRations } from '../model/rations.queries';
import { NewAnimalTypeDialog } from './NewAnimalTypeDialog';

/**
 * "Yem hisoblagichi" home (spec 4): the animal categories — Buqa, Sigir,
 * Qo‘chqor, Qo‘y and the farmer's own — each with its own rations.
 */
export function AnimalTypeGrid({ farm }: { farm: Farm }) {
  const navigate = useNavigate();
  const types = useAnimalTypes(farm.id);
  const rations = useRations(farm.id);
  const animals = useFarmAnimals(farm.id);
  const [adding, setAdding] = useState(false);

  const herdOf = (type: AnimalType) => (animals.data?.items ?? []).filter((animal) => belongsToType(animal, type)).length;
  const rationsOf = (type: AnimalType) => (rations.data?.items ?? []).filter((ration) => ration.animalTypeId === type.id).length;

  return (
    <div className="flex flex-col gap-6">
      <Alert tone="info" title="Hisob siz kiritgan miqdorlar asosida">
        Hayvon turini tanlang va ombordagi yemlardan ratsion tuzing: kunlik va umumiy sarf, xarajat va ombor yetarliligi
        hisoblanadi. Dastur oziqlantirish me’yorini tavsiya qilmaydi. Hisoblash ombordagi qoldiqni o‘zgartirmaydi — u faqat
        “Sarfni ombordan chiqarish”ni tasdiqlaganingizda kamayadi.
      </Alert>

      <section aria-label="Hayvon turlari">
        <AsyncContent
          query={types}
          collection
          loading={
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
              <Skeleton className="h-32" />
            </div>
          }
        >
          {(data) => (
            <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {data.map((type) => (
                <li key={type.id}>
                  <Link
                    to={`/feed-calculator/types/${type.id}`}
                    className="flex h-full items-start gap-3 rounded-[14px] border border-line bg-card p-5 shadow-card transition-colors hover:border-primary-hover"
                  >
                    <span
                      aria-hidden
                      className="inline-flex size-12 shrink-0 items-center justify-center rounded-[12px] bg-primary-light text-ink"
                    >
                      <PawPrint className="size-6" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-lg font-semibold text-ink">{type.name}</span>
                      <span className="block text-[13px] text-ink-secondary">{PROFILE_HINTS[type.profile]}</span>
                      <span className="mt-3 flex flex-wrap gap-2">
                        <Badge tone="neutral">Fermada: {formatInteger(herdOf(type))} bosh</Badge>
                        <Badge tone="primary">Ratsionlar: {formatInteger(rationsOf(type))}</Badge>
                      </span>
                    </span>
                    <ChevronRight aria-hidden className="mt-1 size-5 shrink-0 text-ink-secondary" />
                  </Link>
                </li>
              ))}
              <li>
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="flex h-full min-h-[128px] w-full items-center justify-center gap-2 rounded-[14px] border-2 border-dashed border-line bg-card/60 p-5 font-semibold text-ink-secondary transition-colors hover:border-primary-hover hover:text-ink"
                >
                  <Plus aria-hidden className="size-5" />
                  Yangi hayvon turi
                </button>
              </li>
            </ul>
          )}
        </AsyncContent>
      </section>

      {adding ? (
        <NewAnimalTypeDialog
          farmId={farm.id}
          onClose={() => setAdding(false)}
          onCreated={(type) => {
            setAdding(false);
            navigate(`/feed-calculator/types/${type.id}`);
          }}
        />
      ) : null}
    </div>
  );
}
