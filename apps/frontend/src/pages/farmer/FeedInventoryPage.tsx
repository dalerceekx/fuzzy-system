import { RequireFarm } from '@/features/farms/components/RequireFarm';
import { FeedInventory } from '@/features/feed-inventory/components/FeedInventory';

export default function FeedInventoryPage() {
  return <RequireFarm>{(farm) => <FeedInventory key={farm.id} farm={farm} />}</RequireFarm>;
}
