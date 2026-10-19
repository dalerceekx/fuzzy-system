import { lazy, Suspense } from 'react';

// Statically `null` in production builds: the dev inbox is never bundled.
const DevSmsInboxLazy = import.meta.env.DEV ? lazy(() => import('./DevSmsInbox')) : null;

export function DevSmsInboxSlot() {
  if (!DevSmsInboxLazy) return null;
  return (
    <Suspense fallback={null}>
      <DevSmsInboxLazy />
    </Suspense>
  );
}
