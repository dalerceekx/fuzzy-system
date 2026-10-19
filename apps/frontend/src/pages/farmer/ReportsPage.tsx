import { RequireFarm } from '@/features/farms/components/RequireFarm';
import { Reports } from '@/features/reports/components/Reports';

export default function ReportsPage() {
  return <RequireFarm>{(farm) => <Reports key={farm.id} farm={farm} />}</RequireFarm>;
}
