import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { medicinesApi, type MedicineInput } from '../api/medicines.api';

export const medicineKeys = {
  all: ['medicines'] as const,
  catalog: ['medicines', 'catalog'] as const,
};

/**
 * The whole catalog (the endpoint has no filters; farmers receive only
 * APPROVED rows, staff receive every status).
 */
export function useMedicineCatalog(enabled = true) {
  return useQuery({ queryKey: medicineKeys.catalog, queryFn: medicinesApi.listAll, enabled });
}

function useInvalidateMedicines() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: medicineKeys.all });
}

export function useCreateMedicine() {
  const invalidate = useInvalidateMedicines();
  return useMutation({ mutationFn: (body: MedicineInput) => medicinesApi.create(body), onSuccess: invalidate });
}

export function useApproveMedicine() {
  const invalidate = useInvalidateMedicines();
  return useMutation({ mutationFn: (id: string) => medicinesApi.approve(id), onSuccess: invalidate });
}

export function useArchiveMedicine() {
  const invalidate = useInvalidateMedicines();
  return useMutation({ mutationFn: (id: string) => medicinesApi.archive(id), onSuccess: invalidate });
}
