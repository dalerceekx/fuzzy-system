import { useMatches } from 'react-router';
import { FarmSwitcher } from '@/features/farms/components/FarmSwitcher';
import { useActiveFarm } from '@/features/farms/model/active-farm';
import { initials } from '@/shared/lib/format';
import type { PublicUser } from '@/shared/types/api';
import { BrandMark } from '@/shared/ui/BrandMark';
import { ProfileMenu } from '@/widgets/profile-dropdown/ProfileMenu';

export interface RouteHandle {
  title: string;
  description?: string;
}

function isRouteHandle(value: unknown): value is RouteHandle {
  return typeof value === 'object' && value !== null && typeof (value as RouteHandle).title === 'string';
}

/** Title/description of the deepest matched route that declares one. */
export function useRouteHandle(): RouteHandle | null {
  const matches = useMatches();
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const handle = matches[index]?.handle;
    if (isRouteHandle(handle)) return handle;
  }
  return null;
}

/** Farm initials in a straw circle + farm name; a selector when there are several farms. */
function FarmBrand() {
  const { farms, activeFarm } = useActiveFarm();
  const name = activeFarm?.name ?? 'MeningFermam';
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span aria-hidden className="farm-logo">
        {initials(name)}
      </span>
      {farms.length > 1 ? (
        <FarmSwitcher />
      ) : (
        <span className="flex min-w-0 flex-col leading-tight">
          <span className="truncate text-[15px] font-bold text-ink">{name}</span>
          <span className="text-xs text-ink-secondary">Ferma boshqaruvi</span>
        </span>
      )}
    </div>
  );
}

/** Top bar: brand on the left, profile on the right. Navigation lives in the tab bar. */
export function Header({ user }: { user: PublicUser }) {
  return (
    <header className="sticky top-0 z-20 border-b border-line bg-background/92 backdrop-blur-[6px]">
      <div className="mx-auto flex min-h-16 w-full max-w-[1240px] items-center gap-3 px-4 py-3 sm:px-6 lg:px-7">
        {user.role === 'FARMER' ? <FarmBrand /> : <BrandMark />}
        {user.isDemo ? (
          <span className="hidden rounded-full bg-primary-light px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-primary-dark min-[421px]:inline">
            Demo rejim
          </span>
        ) : null}
        <div className="flex-1" />
        <ProfileMenu user={user} />
      </div>
    </header>
  );
}
