import { Archive, Pencil, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import type { Farm } from '@/features/farms/api/farms.api';
import { useDebouncedValue } from '@/shared/hooks/useDebouncedValue';
import { formatDecimal, formatInteger } from '@/shared/lib/format';
import {
  AsyncContent,
  Badge,
  Button,
  Card,
  Checkbox,
  DataTable,
  EmptyState,
  IconButton,
  Input,
  Pagination,
  Select,
  type Column,
} from '@/shared/ui';
import { SPECIES, type Animal, type Species } from '../api/animals.api';
import {
  AGE_CATEGORIES,
  AGE_CATEGORY_LABELS,
  ageCategory,
  ageLabel,
  SPECIES_LABELS,
  speciesWithKind,
  type AgeCategory,
} from '../lib/labels';
import { useFarmAnimals } from '../model/animals.queries';
import { AnimalFormDialog } from './AnimalFormDialog';
import { ArchiveAnimalDialog } from './ArchiveAnimalDialog';

const PAGE_SIZE = 20;

function isSpecies(value: string | null): value is Species {
  return value !== null && (SPECIES as readonly string[]).includes(value);
}

function isAgeCategory(value: string | null): value is AgeCategory {
  return value !== null && (AGE_CATEGORIES as readonly string[]).includes(value);
}

export function AnimalsList({ farm }: { farm: Farm }) {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const species = isSpecies(params.get('species')) ? (params.get('species') as Species) : null;
  const age = isAgeCategory(params.get('age')) ? (params.get('age') as AgeCategory) : null;
  const includeArchived = params.get('archived') === '1';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [search, setSearch] = useState(params.get('q') ?? '');
  const debouncedSearch = useDebouncedValue(search.trim().toLocaleLowerCase('uz'));

  const [editing, setEditing] = useState<Animal | null>(null);
  const [archiving, setArchiving] = useState<Animal | null>(null);
  const creating = params.get('new') === '1';

  const animals = useFarmAnimals(farm.id, includeArchived);

  function updateParams(changes: Record<string, string | null>): void {
    setParams(
      (current) => {
        const next = new URLSearchParams(current);
        for (const [key, value] of Object.entries(changes)) {
          if (value === null || value === '') next.delete(key);
          else next.set(key, value);
        }
        if (!('page' in changes)) next.delete('page');
        return next;
      },
      { replace: true },
    );
  }

  const filtered = useMemo(() => {
    const items = animals.data?.items ?? [];
    return items.filter((animal) => {
      if (species && animal.species !== species) return false;
      if (age && ageCategory(animal.birthDate) !== age) return false;
      if (!debouncedSearch) return true;
      return (
        animal.tagNumber.toLocaleLowerCase('uz').includes(debouncedSearch) ||
        (animal.name?.toLocaleLowerCase('uz').includes(debouncedSearch) ?? false)
      );
    });
  }, [animals.data, species, age, debouncedSearch]);

  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const hasFilters = Boolean(species || age || debouncedSearch);

  const columns: Column<Animal>[] = [
    {
      key: 'tag',
      header: 'Birka / laqab',
      cell: (animal) => (
        <div className="min-w-0">
          <p className="font-semibold text-ink">{animal.tagNumber}</p>
          {animal.name ? <p className="text-[13px] text-ink-secondary">{animal.name}</p> : null}
        </div>
      ),
    },
    {
      key: 'kind',
      header: 'Turi',
      cell: (animal) => {
        const label = speciesWithKind(animal.species, animal.sex);
        return (
          <span>
            {label.species}
            {label.kind ? <span className="text-ink-secondary"> · {label.kind}</span> : null}
          </span>
        );
      },
    },
    { key: 'age', header: 'Yoshi', cell: (animal) => ageLabel(animal.birthDate) },
    {
      key: 'weight',
      header: 'Vazni',
      align: 'right',
      cell: (animal) => (animal.weightKg ? `${formatDecimal(animal.weightKg, { maxFractionDigits: 2 })} kg` : '—'),
    },
    {
      key: 'status',
      header: 'Holati',
      hideOnMobile: !includeArchived,
      cell: (animal) => (animal.archivedAt ? <Badge tone="neutral">Arxivda</Badge> : <Badge tone="success">Faol</Badge>),
    },
    {
      key: 'actions',
      header: <span className="sr-only">Amallar</span>,
      align: 'right',
      hideOnMobile: true,
      cell: (animal) =>
        animal.archivedAt ? null : (
          <div className="flex justify-end gap-1">
            <IconButton
              label={`${animal.tagNumber} ni tahrirlash`}
              icon={<Pencil aria-hidden className="size-4" />}
              onClick={() => setEditing(animal)}
            />
            <IconButton
              label={`${animal.tagNumber} ni arxivlash`}
              icon={<Archive aria-hidden className="size-4" />}
              onClick={() => setArchiving(animal)}
            />
          </div>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      <Card>
        <div className="flex flex-col gap-3 px-4 py-4 lg:flex-row lg:items-end">
          <div className="relative flex-1">
            <label htmlFor="animal-search" className="sr-only">
              Qidirish
            </label>
            <Search
              aria-hidden
              className="pointer-events-none absolute top-1/2 left-3 size-5 -translate-y-1/2 text-ink-secondary"
            />
            <Input
              id="animal-search"
              type="search"
              placeholder="Birka raqami yoki laqab bo‘yicha qidirish"
              className="pl-10"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                updateParams({ q: event.target.value || null });
              }}
            />
          </div>
          <div className="grid grid-cols-2 gap-3 sm:flex sm:items-center">
            <div className="sm:w-48">
              <label htmlFor="animal-species" className="sr-only">
                Hayvon turi
              </label>
              <Select
                id="animal-species"
                value={species ?? ''}
                onChange={(event) => updateParams({ species: event.target.value || null })}
              >
                <option value="">Barcha turlar</option>
                {SPECIES.map((value) => (
                  <option key={value} value={value}>
                    {SPECIES_LABELS[value]}
                  </option>
                ))}
              </Select>
            </div>
            <div className="sm:w-48">
              <label htmlFor="animal-age" className="sr-only">
                Yosh toifasi
              </label>
              <Select id="animal-age" value={age ?? ''} onChange={(event) => updateParams({ age: event.target.value || null })}>
                <option value="">Barcha yoshlar</option>
                {AGE_CATEGORIES.map((value) => (
                  <option key={value} value={value}>
                    {AGE_CATEGORY_LABELS[value]}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <Button icon={<Plus aria-hidden className="size-5" />} onClick={() => updateParams({ new: '1' })}>
            Hayvon qo‘shish
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-2.5">
          <p className="text-sm text-ink-secondary" aria-live="polite">
            {animals.data ? `${formatInteger(filtered.length)} ta hayvon` : ' '}
            {animals.data?.truncated ? ' (ro‘yxat juda katta — birinchi 2 000 tasi ko‘rsatilmoqda)' : ''}
          </p>
          <Checkbox
            label="Arxivdagilarni ham ko‘rsatish"
            checked={includeArchived}
            onChange={(event) => updateParams({ archived: event.target.checked ? '1' : null })}
          />
        </div>
      </Card>

      <Card>
        <AsyncContent
          query={animals}
          collection
          isEmpty={() => filtered.length === 0}
          empty={
            hasFilters ? (
              <EmptyState title="Mos hayvon topilmadi" description="Qidiruv yoki filtrlarni o‘zgartirib ko‘ring." />
            ) : (
              <EmptyState
                title="Hali hayvon qo‘shilmagan"
                description="Birinchi hayvoningizni qo‘shing — birka raqami va turi kifoya."
                action={
                  <Button icon={<Plus aria-hidden className="size-5" />} onClick={() => updateParams({ new: '1' })}>
                    Hayvon qo‘shish
                  </Button>
                }
              />
            )
          }
        >
          {() => (
            <>
              <DataTable
                caption="Hayvonlar ro‘yxati"
                columns={columns}
                rows={pageItems}
                rowKey={(animal) => animal.id}
                onRowClick={(animal) => navigate(`/animals/${animal.id}`)}
              />
              <Pagination
                page={page}
                limit={PAGE_SIZE}
                total={filtered.length}
                onPageChange={(next) => updateParams({ page: String(next) })}
              />
            </>
          )}
        </AsyncContent>
      </Card>

      <AnimalFormDialog
        open={creating || editing !== null}
        animal={editing}
        farmId={farm.id}
        farmName={farm.name}
        onClose={() => {
          setEditing(null);
          if (creating) updateParams({ new: null });
        }}
      />
      <ArchiveAnimalDialog animal={archiving} onClose={() => setArchiving(null)} />
    </div>
  );
}
