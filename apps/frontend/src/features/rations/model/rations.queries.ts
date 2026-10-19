import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useInvalidateInventory } from '@/features/inventory/model/inventory.queries';
import { rationsApi, type CreateAnimalTypeInput, type RationInput } from '../api/rations.api';

export const rationKeys = {
  all: ['rations'] as const,
  profiles: ['rations', 'profiles'] as const,
  types: (farmId: string) => ['rations', 'types', farmId] as const,
  list: (farmId: string, animalTypeId: string | undefined) => ['rations', 'list', farmId, animalTypeId ?? 'ALL'] as const,
  detail: (id: string) => ['rations', 'detail', id] as const,
  issues: (id: string) => ['rations', 'issues', id] as const,
};

/** Profile configuration: static on the server, cached for the session. */
export function useRationProfiles() {
  return useQuery({ queryKey: rationKeys.profiles, queryFn: rationsApi.profiles, staleTime: Infinity });
}

export function useAnimalTypes(farmId: string) {
  return useQuery({ queryKey: rationKeys.types(farmId), queryFn: () => rationsApi.animalTypes(farmId) });
}

/** A farm has few rations: one page of 100 covers them. */
export function useRations(farmId: string, animalTypeId?: string) {
  return useQuery({
    queryKey: rationKeys.list(farmId, animalTypeId),
    queryFn: () => rationsApi.list({ farmId, animalTypeId, limit: 100, sort: '-updatedAt' }),
  });
}

export function useRation(id: string) {
  return useQuery({ queryKey: rationKeys.detail(id), queryFn: () => rationsApi.get(id) });
}

export function useRationIssues(id: string) {
  return useQuery({ queryKey: rationKeys.issues(id), queryFn: () => rationsApi.issues(id, { limit: 20 }) });
}

function useInvalidateRations() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: rationKeys.all });
}

export function useCreateAnimalType() {
  const invalidate = useInvalidateRations();
  return useMutation({ mutationFn: (body: CreateAnimalTypeInput) => rationsApi.createAnimalType(body), onSuccess: invalidate });
}

export function useArchiveAnimalType() {
  const invalidate = useInvalidateRations();
  return useMutation({ mutationFn: (id: string) => rationsApi.archiveAnimalType(id), onSuccess: invalidate });
}

export function useSaveRation(farmId: string) {
  const invalidate = useInvalidateRations();
  return useMutation({
    mutationFn: ({ id, body }: { id?: string; body: RationInput }) =>
      id ? rationsApi.update(id, body) : rationsApi.create(farmId, body),
    onSuccess: invalidate,
  });
}

export function useCopyRation() {
  const invalidate = useInvalidateRations();
  return useMutation({ mutationFn: (id: string) => rationsApi.copy(id), onSuccess: invalidate });
}

export function useArchiveRation() {
  const invalidate = useInvalidateRations();
  return useMutation({ mutationFn: (id: string) => rationsApi.archive(id), onSuccess: invalidate });
}

/** The real consumption: stock and the ration's issue history change. */
export function useIssueRation() {
  const invalidateRations = useInvalidateRations();
  const invalidateInventory = useInvalidateInventory();
  return useMutation({
    mutationFn: ({ id, days, idempotencyKey }: { id: string; days: number; idempotencyKey: string }) =>
      rationsApi.issue(id, days, idempotencyKey),
    onSuccess: () => Promise.all([invalidateRations(), invalidateInventory()]),
  });
}
