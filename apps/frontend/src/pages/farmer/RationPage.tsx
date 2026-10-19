import { useParams } from 'react-router';
import { RequireFarm } from '@/features/farms/components/RequireFarm';
import { RationDetails } from '@/features/rations/components/RationDetails';

export default function RationPage() {
  const { rationId = '' } = useParams();
  return <RequireFarm>{() => <RationDetails key={rationId} rationId={rationId} />}</RequireFarm>;
}
