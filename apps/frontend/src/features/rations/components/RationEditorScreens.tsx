import type { Farm } from '@/features/farms/api/farms.api';
import { Alert, ButtonLink, Card, EmptyState, ErrorState, PageLoader } from '@/shared/ui';
import { useAnimalTypes, useRation, useRationProfiles } from '../model/rations.queries';
import { RationEditor } from './RationEditor';

function NotFound({ title }: { title: string }) {
  return (
    <Card>
      <EmptyState
        title={title}
        action={
          <ButtonLink to="/feed-calculator" variant="secondary">
            Yem hisoblagichga qaytish
          </ButtonLink>
        }
      />
    </Card>
  );
}

/** New ration for one animal category (its profile decides the form). */
export function NewRationScreen({ farm, typeId }: { farm: Farm; typeId: string }) {
  const types = useAnimalTypes(farm.id);
  const profiles = useRationProfiles();
  if (types.isPending || profiles.isPending) return <PageLoader />;
  if (types.isError || profiles.isError) {
    const failed = types.isError ? types : profiles;
    return (
      <Card>
        <ErrorState error={failed.error} collection onRetry={() => void failed.refetch()} />
      </Card>
    );
  }
  const type = types.data.find((candidate) => candidate.id === typeId);
  const config = profiles.data.find((candidate) => candidate.profile === type?.profile);
  if (!type || !config) return <NotFound title="Hayvon turi topilmadi" />;
  return <RationEditor farm={farm} type={type} config={config} backTo={`/feed-calculator/types/${type.id}`} />;
}

export function EditRationScreen({ farm, rationId }: { farm: Farm; rationId: string }) {
  const ration = useRation(rationId);
  const profiles = useRationProfiles();
  if (ration.isPending || profiles.isPending) return <PageLoader />;
  if (ration.isError || profiles.isError) {
    const failed = ration.isError ? ration : profiles;
    return (
      <Card>
        <ErrorState error={failed.error} onRetry={() => void failed.refetch()} />
      </Card>
    );
  }
  const data = ration.data;
  const config = profiles.data.find((candidate) => candidate.profile === data.animalType.profile);
  if (!config) return <NotFound title="Hayvon turi topilmadi" />;
  if (data.archivedAt) {
    return (
      <Alert tone="warning" title="Ratsion o‘chirilgan">
        O‘chirilgan ratsionni tahrirlab bo‘lmaydi — undan nusxa oling yoki yangisini tuzing.
      </Alert>
    );
  }
  return (
    <RationEditor
      key={data.id}
      farm={farm}
      type={data.animalType}
      config={config}
      ration={data}
      backTo={`/feed-calculator/rations/${data.id}`}
    />
  );
}
