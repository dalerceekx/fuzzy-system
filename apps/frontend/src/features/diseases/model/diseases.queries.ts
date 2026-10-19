import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { diseasesApi, type DiseaseFilters } from '../api/diseases.api';

/** Reference text never changes in a session: cached without refetching. */
const STATIC = { staleTime: Infinity, gcTime: 30 * 60_000 } as const;

export const diseaseKeys = {
  groups: ['diseases', 'groups'] as const,
  list: (filters: DiseaseFilters) => ['diseases', 'list', filters] as const,
  detail: (number: number) => ['diseases', 'detail', number] as const,
  source: ['diseases', 'source'] as const,
};

export function useDiseaseGroups() {
  return useQuery({ queryKey: diseaseKeys.groups, queryFn: diseasesApi.groups, ...STATIC });
}

export function useDiseases(filters: DiseaseFilters) {
  return useQuery({
    queryKey: diseaseKeys.list(filters),
    queryFn: () => diseasesApi.list(filters),
    placeholderData: keepPreviousData,
    ...STATIC,
  });
}

export function useDisease(number: number) {
  return useQuery({ queryKey: diseaseKeys.detail(number), queryFn: () => diseasesApi.get(number), ...STATIC });
}

export function useDiseaseSource() {
  return useQuery({ queryKey: diseaseKeys.source, queryFn: diseasesApi.source, ...STATIC });
}
