import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { animalsApi, SPECIES, type CreateAnimalInput, type Species, type UpdateAnimalInput } from '../api/animals.api';

export const animalKeys = {
  all: ['animals'] as const,
  list: (farmId: string, includeArchived: boolean) => ['animals', 'list', farmId, { includeArchived }] as const,
  count: (farmId: string, species: Species | 'ALL') => ['animals', 'count', farmId, species] as const,
  detail: (id: string) => ['animals', 'detail', id] as const,
};

/**
 * Every animal of a farm (100 per request). The list endpoint has no text
 * search or age filter, so the page searches the full set locally — never
 * only the first page.
 */
export function useFarmAnimals(farmId: string, includeArchived = false) {
  return useQuery({
    queryKey: animalKeys.list(farmId, includeArchived),
    queryFn: () => animalsApi.listAll({ farmId, includeArchived: includeArchived || undefined, sort: 'tagNumber' }),
  });
}

/** Exact totals from the server (`total` of a 1-item page): overall and per species. */
export function useAnimalCounts(farmId: string) {
  const keys: Array<Species | 'ALL'> = ['ALL', ...SPECIES];
  const results = useQueries({
    queries: keys.map((species) => ({
      queryKey: animalKeys.count(farmId, species),
      queryFn: async () => {
        const page = await animalsApi.list({ farmId, limit: 1, ...(species === 'ALL' ? {} : { species }) });
        return page.total;
      },
    })),
  });
  const [total, ...bySpecies] = results;
  return {
    isPending: results.some((result) => result.isPending),
    error: results.find((result) => result.error)?.error ?? null,
    total: total?.data,
    bySpecies: SPECIES.map((species, index) => ({ species, count: bySpecies[index]?.data ?? 0 })),
    refetch: () => results.forEach((result) => void result.refetch()),
  };
}

export function useAnimal(id: string) {
  return useQuery({ queryKey: animalKeys.detail(id), queryFn: () => animalsApi.get(id) });
}

export function useCreateAnimal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: CreateAnimalInput) => animalsApi.create(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: animalKeys.all }),
  });
}

export function useUpdateAnimal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAnimalInput }) => animalsApi.update(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: animalKeys.all }),
  });
}

export function useArchiveAnimal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) => animalsApi.archive(id, reason),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: animalKeys.all }),
  });
}
