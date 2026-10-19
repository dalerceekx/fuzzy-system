import { AnimalsList } from '@/features/animals/components/AnimalsList';
import { RequireFarm } from '@/features/farms/components/RequireFarm';

export default function AnimalsPage() {
  return <RequireFarm>{(farm) => <AnimalsList key={farm.id} farm={farm} />}</RequireFarm>;
}
