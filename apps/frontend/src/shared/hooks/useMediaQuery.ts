import { useSyncExternalStore } from 'react';

function subscribe(query: string, onChange: () => void): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
  const list = window.matchMedia(query);
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

function matches(query: string): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return true;
  return window.matchMedia(query).matches;
}

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => subscribe(query, onChange),
    () => matches(query),
    () => true,
  );
}

/** Tailwind `md` breakpoint (768px): tables vs. cards. */
export function useIsDesktop(): boolean {
  return useMediaQuery('(min-width: 768px)');
}
