import { RequireFarm } from '@/features/farms/components/RequireFarm';
import { AnimalTypeGrid } from '@/features/rations/components/AnimalTypeGrid';

export default function FeedCalculatorPage() {
  return <RequireFarm>{(farm) => <AnimalTypeGrid key={farm.id} farm={farm} />}</RequireFarm>;
}
