import { RequireFarm } from '@/features/farms/components/RequireFarm';
import { FarmerDashboard } from '@/widgets/dashboard-stats/FarmerDashboard';

export default function DashboardPage() {
  return <RequireFarm>{(farm) => <FarmerDashboard key={farm.id} farm={farm} />}</RequireFarm>;
}
