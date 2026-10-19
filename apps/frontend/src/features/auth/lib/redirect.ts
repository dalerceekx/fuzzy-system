import type { Location } from 'react-router';
import type { UserRole } from '@/shared/types/api';
import { roleHome } from './permissions';

interface FromState {
  from?: Pick<Location, 'pathname' | 'search'>;
}

const STAFF_PREFIX = '/admin';

function isProfilePath(pathname: string): boolean {
  return pathname === '/profile' || pathname.startsWith('/profile/');
}

/**
 * Where to go after login: the page the user originally asked for (kept in
 * the router state by RequireAuth), if their role may open it; otherwise
 * the role's home page.
 */
export function postLoginTarget(role: UserRole, state: unknown): string {
  const from = (state as FromState | null)?.from;
  const home = roleHome(role);
  if (!from?.pathname || from.pathname === '/' || from.pathname.startsWith('/login')) return home;
  const wantsStaffArea = from.pathname.startsWith(STAFF_PREFIX);
  const isStaff = role !== 'FARMER';
  if (wantsStaffArea !== isStaff && !isProfilePath(from.pathname)) return home;
  return `${from.pathname}${from.search ?? ''}`;
}
