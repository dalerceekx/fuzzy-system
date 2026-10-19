import { useLocation, useParams } from 'react-router';
import { InventoryItemDetails } from '@/features/inventory/components/InventoryItemDetails';

/** Shared by /feed/:itemId and /medicines/stock/:itemId. */
export default function InventoryItemPage() {
  const { itemId = '' } = useParams();
  const isMedicine = useLocation().pathname.startsWith('/medicines');
  return (
    <InventoryItemDetails
      itemId={itemId}
      backTo={isMedicine ? '/medicines' : '/feed'}
      backLabel={isMedicine ? 'Dori ombori' : 'Yem ombori'}
    />
  );
}
