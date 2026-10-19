import { BookOpenText, ChevronRight, SearchX } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';
import { cn } from '@/shared/lib/cn';
import { Alert, AsyncContent, Badge, Button, ButtonLink, Card, CardBody, EmptyState, Field, Input, Select } from '@/shared/ui';
import { DISEASE_ANIMALS, type DiseaseSummary } from '../api/diseases.api';
import { ANIMAL_LABELS } from '../lib/labels';
import { useDiseaseGroups, useDiseases } from '../model/diseases.queries';

function Chip({ pressed, onClick, children }: { pressed: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        'min-h-10 rounded-full border px-3.5 text-sm font-medium transition-colors',
        pressed ? 'border-primary-hover bg-primary text-ink' : 'border-line bg-card text-ink-secondary hover:border-input-line',
      )}
    >
      {children}
    </button>
  );
}

function DiseaseRow({ disease, back }: { disease: DiseaseSummary; back: string }) {
  return (
    <li>
      <Link
        to={`/diseases/${disease.number}`}
        state={{ back }}
        className="flex items-start gap-3 rounded-[14px] border border-line bg-card p-4 shadow-card transition-colors hover:border-primary-hover"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-semibold text-ink">
            {disease.number}. {disease.name}
          </span>
          {disease.scientificNames ? (
            <span className="mt-0.5 block text-[13px] text-ink-secondary">{disease.scientificNames}</span>
          ) : null}
          <span className="mt-2 flex flex-wrap gap-1.5">
            {disease.animals.map((animal) => (
              <Badge key={animal} tone="neutral">
                {ANIMAL_LABELS[animal]}
              </Badge>
            ))}
          </span>
        </span>
        <ChevronRight aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-secondary" />
      </Link>
    </li>
  );
}

/**
 * "Molim kasal": pick the animal, the disease group, then a disease — or
 * search by name / symptom. Filters combine and live in the URL, so "back"
 * from a disease returns to the same list. A reference, not a diagnosis.
 */
export function DiseaseBrowser() {
  const [params, setParams] = useSearchParams();
  const groups = useDiseaseGroups();
  const animal = DISEASE_ANIMALS.find((value) => value === params.get('animal'));
  const groupParam = Number(params.get('group'));
  const groupNumber = Number.isInteger(groupParam) && groupParam > 0 ? groupParam : undefined;
  const [search, setSearch] = useState(params.get('q') ?? '');
  const q = useDebouncedValue(search.trim(), 300);
  const list = useDiseases({ animal, groupNumber, q: q || undefined });

  function setParam(key: string, value: string | null): void {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        if (value) next.set(key, value);
        else next.delete(key);
        return next;
      },
      { replace: true },
    );
  }

  // The debounced search text follows into the URL (shareable, kept on "back").
  useEffect(() => {
    setParam('q', q || null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const filtered = Boolean(animal || groupNumber || q);
  const headingOf = (number: number) => groups.data?.find((group) => group.number === number)?.heading ?? `${number}-bo‘lim`;

  function clearFilters(): void {
    setSearch('');
    setParams(new URLSearchParams(), { replace: true });
  }

  return (
    <div className="flex flex-col gap-5">
      <Alert tone="info" title="Ma’lumotnoma — tashxis emas">
        Hayvon turi va kasallik guruhini tanlang, so‘ng kasallikni oching — manba matni to‘liq ko‘rsatiladi. Ilova alomatlarga
        qarab tashxis qo‘ymaydi va dori dozasini hisoblamaydi.
      </Alert>

      <Card>
        <CardBody className="flex flex-col gap-4">
          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-ink">1. Hayvon turi</legend>
            <div className="flex flex-wrap gap-2">
              <Chip pressed={!animal} onClick={() => setParam('animal', null)}>
                Barchasi
              </Chip>
              {DISEASE_ANIMALS.map((value) => (
                <Chip key={value} pressed={animal === value} onClick={() => setParam('animal', value)}>
                  {ANIMAL_LABELS[value]}
                </Chip>
              ))}
            </div>
          </fieldset>
          <Field label="2. Kasallik guruhi">
            <Select value={groupNumber ?? ''} onChange={(event) => setParam('group', event.target.value || null)}>
              <option value="">Barcha guruhlar</option>
              {(groups.data ?? []).map((group) => (
                <option key={group.number} value={group.number}>
                  {group.heading}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Qidirish: kasallik nomi yoki alomati">
            <Input
              type="search"
              autoComplete="off"
              placeholder="Masalan: mastit, yo‘tal, ich ketishi"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </Field>
        </CardBody>
      </Card>

      <section aria-label="Kasalliklar" className="flex flex-col gap-4">
        <h2 className="text-base font-semibold text-ink">3. Kasallikni tanlang</h2>
        <AsyncContent
          query={list}
          collection
          isEmpty={(data) => data.length === 0}
          empty={
            <Card>
              <EmptyState
                icon={<SearchX className="size-6" />}
                title="Hech narsa topilmadi"
                description="Boshqa so‘z bilan qidiring yoki filtrlarni o‘zgartiring."
                action={
                  filtered ? (
                    <Button variant="secondary" onClick={clearFilters}>
                      Filtrlarni tozalash
                    </Button>
                  ) : undefined
                }
              />
            </Card>
          }
        >
          {(data) => {
            const numbers = [...new Set(data.map((disease) => disease.groupNumber))];
            return (
              <div className="flex flex-col gap-5">
                {numbers.map((number) => (
                  <div key={number} className="flex flex-col gap-2.5">
                    <h3 className="text-[13px] font-semibold tracking-wide text-ink-secondary">{headingOf(number)}</h3>
                    <ul aria-label={headingOf(number)} className="flex flex-col gap-2.5">
                      {data
                        .filter((disease) => disease.groupNumber === number)
                        .map((disease) => (
                          <DiseaseRow key={disease.number} disease={disease} back={`/diseases?${params.toString()}`} />
                        ))}
                    </ul>
                  </div>
                ))}
              </div>
            );
          }}
        </AsyncContent>
      </section>

      <div>
        <ButtonLink to="/diseases/source" variant="secondary" icon={<BookOpenText aria-hidden className="size-5" />}>
          Asl matn (butun manba)
        </ButtonLink>
      </div>
    </div>
  );
}
