import type { ReactNode } from 'react';
import { formatInteger } from '@/shared/lib/format';
import { DataTable, type Column } from '@/shared/ui';
import type { Medicine } from '../api/medicines.api';
import { MedicineStatusBadge, SampleMedicineNotice } from './MedicineStatus';

interface MedicineCatalogTableProps {
  medicines: Medicine[];
  /** Extra actions column (staff). */
  actions?: (medicine: Medicine) => ReactNode;
}

/**
 * Catalog data exactly as the backend stores it. The app shows no dosing
 * advice: withdrawal periods are reference data entered by veterinarians.
 */
export function MedicineCatalogTable({ medicines, actions }: MedicineCatalogTableProps) {
  const columns: Column<Medicine>[] = [
    {
      key: 'name',
      header: 'Nomi',
      cell: (medicine) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-semibold">{medicine.name}</span>
          <SampleMedicineNotice medicine={medicine} />
        </div>
      ),
    },
    { key: 'ingredient', header: 'Ta’sir qiluvchi modda', cell: (medicine) => medicine.activeIngredient },
    {
      key: 'form',
      header: 'Shakli',
      hideOnMobile: true,
      cell: (medicine) => [medicine.form, medicine.concentration].filter(Boolean).join(', ') || '—',
    },
    {
      key: 'withdrawal',
      header: 'Kutish muddati (go‘sht / sut)',
      cell: (medicine) => `${formatInteger(medicine.withdrawalMeatDays)} / ${formatInteger(medicine.withdrawalMilkDays)} kun`,
    },
    { key: 'status', header: 'Holati', cell: (medicine) => <MedicineStatusBadge status={medicine.status} /> },
    ...(actions
      ? [{ key: 'actions', header: <span className="sr-only">Amallar</span>, align: 'right' as const, cell: actions }]
      : []),
  ];
  return <DataTable caption="Dorilar katalogi" columns={columns} rows={medicines} rowKey={(medicine) => medicine.id} />;
}
