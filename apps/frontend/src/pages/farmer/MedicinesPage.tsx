import { BookOpen } from 'lucide-react';
import { useState } from 'react';
import { RequireFarm } from '@/features/farms/components/RequireFarm';
import { MedicineCatalogTable } from '@/features/medicines/components/MedicineCatalogTable';
import { MedicineStock } from '@/features/medicines/components/MedicineStock';
import { useMedicineCatalog } from '@/features/medicines/model/medicines.queries';
import { Alert, AsyncContent, Card, CardHeader, EmptyState, SegmentedTabs } from '@/shared/ui';

type View = 'stock' | 'catalog';

function ApprovedCatalog() {
  const catalog = useMedicineCatalog();
  return (
    <Card>
      <CardHeader
        title="Tasdiqlangan dorilar"
        description="Veterinar tomonidan tasdiqlangan dorilar ro‘yxati"
        icon={<BookOpen className="size-5" />}
      />
      <AsyncContent
        query={catalog}
        collection
        isEmpty={(data) => data.length === 0}
        empty={<EmptyState title="Tasdiqlangan dorilar hali yo‘q" />}
      >
        {(data) => <MedicineCatalogTable medicines={data.filter((medicine) => medicine.status === 'APPROVED')} />}
      </AsyncContent>
    </Card>
  );
}

export default function MedicinesPage() {
  const [view, setView] = useState<View>('stock');
  return (
    <div className="flex flex-col gap-5">
      <Alert tone="info">
        Bu bo‘lim dorilar zaxirasini hisobga olish uchun. Dori tanlash va dozalash bo‘yicha qarorni faqat veterinar qabul qiladi.
      </Alert>
      <SegmentedTabs<View>
        label="Dorilar bo‘limi"
        value={view}
        onChange={setView}
        tabs={[
          { value: 'stock', label: 'Ombordagi dorilar' },
          { value: 'catalog', label: 'Katalog' },
        ]}
      />
      {view === 'stock' ? (
        <RequireFarm>{(farm) => <MedicineStock key={farm.id} farm={farm} />}</RequireFarm>
      ) : (
        <ApprovedCatalog />
      )}
    </div>
  );
}
