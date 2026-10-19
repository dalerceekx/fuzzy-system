import { useParams } from 'react-router';
import { RequireFarm } from '@/features/farms/components/RequireFarm';
import { AnimalTypeRations } from '@/features/rations/components/AnimalTypeRations';

export default function RationTypePage() {
  const { typeId = '' } = useParams();
  return <RequireFarm>{(farm) => <AnimalTypeRations key={`${farm.id}:${typeId}`} farm={farm} typeId={typeId} />}</RequireFarm>;
}
