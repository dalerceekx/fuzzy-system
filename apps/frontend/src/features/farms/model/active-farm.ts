import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { useCurrentUser } from '@/features/auth/hooks/useCurrentUser';
import { safeLocalStorage } from '@/shared/lib/safe-storage';
import { farmsApi, type FarmInput } from '../api/farms.api';

export const farmKeys = {
  all: ['farms'] as const,
  list: ['farms', 'list'] as const,
};

interface ActiveFarmState {
  /** userId → farmId; a per-browser preference only. */
  byUser: Record<string, string>;
  select: (userId: string, farmId: string) => void;
}

export const useActiveFarmStore = create<ActiveFarmState>()(
  persist(
    (set) => ({
      byUser: {},
      select: (userId, farmId) => set((state) => ({ byUser: { ...state.byUser, [userId]: farmId } })),
    }),
    { name: 'mf-active-farm', storage: createJSONStorage(() => safeLocalStorage) },
  ),
);

export function useFarms() {
  return useQuery({ queryKey: farmKeys.list, queryFn: farmsApi.listAll });
}

/** The farm the farmer is working with (first active farm by default). */
export function useActiveFarm() {
  const { data: user } = useCurrentUser();
  const farmsQuery = useFarms();
  const selectedId = useActiveFarmStore((state) => (user ? state.byUser[user.id] : undefined));
  const select = useActiveFarmStore((state) => state.select);

  const farms = (farmsQuery.data ?? []).filter((farm) => !farm.archivedAt);
  const activeFarm = farms.find((farm) => farm.id === selectedId) ?? farms[0] ?? null;

  return {
    farmsQuery,
    farms,
    activeFarm,
    setActiveFarm: (farmId: string) => {
      if (user) select(user.id, farmId);
    },
  };
}

export function useCreateFarm() {
  const queryClient = useQueryClient();
  const { data: user } = useCurrentUser();
  const select = useActiveFarmStore((state) => state.select);
  return useMutation({
    mutationFn: farmsApi.create,
    onSuccess: (farm) => {
      if (user) select(user.id, farm.id);
      return queryClient.invalidateQueries({ queryKey: farmKeys.all });
    },
  });
}

export function useUpdateFarm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<FarmInput> }) => farmsApi.update(id, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: farmKeys.all }),
  });
}

export function useArchiveFarm() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: farmsApi.archive,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: farmKeys.all }),
  });
}
