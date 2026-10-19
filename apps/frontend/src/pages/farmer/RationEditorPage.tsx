import { useParams } from 'react-router';
import { RequireFarm } from '@/features/farms/components/RequireFarm';
import { EditRationScreen, NewRationScreen } from '@/features/rations/components/RationEditorScreens';

/** /feed-calculator/types/:typeId/new and /feed-calculator/rations/:rationId/edit */
export default function RationEditorPage() {
  const { typeId, rationId } = useParams();
  return (
    <RequireFarm>
      {(farm) =>
        rationId ? (
          <EditRationScreen key={rationId} farm={farm} rationId={rationId} />
        ) : (
          <NewRationScreen key={`${farm.id}:${typeId ?? ''}`} farm={farm} typeId={typeId ?? ''} />
        )
      }
    </RequireFarm>
  );
}
