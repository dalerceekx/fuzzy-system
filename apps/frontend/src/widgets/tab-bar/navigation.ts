import {
  Archive,
  Calculator,
  ChartColumn,
  CircleEllipsis,
  House,
  LayoutGrid,
  PawPrint,
  Pill,
  ScrollText,
  Settings,
  Shield,
  ShieldCheck,
  Stethoscope,
  Tractor,
  UserRound,
  Users,
  Warehouse,
  type LucideIcon,
} from 'lucide-react';
import { can, roleHome } from '@/features/auth/lib/permissions';
import type { UserRole } from '@/shared/types/api';

/** A row of a sheet: iOS-style coloured square icon + label. */
export interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Background of the square icon. */
  color: string;
  visible: (role: UserRole) => boolean;
}

/** Tab that opens a sheet of links above the tab bar. */
export interface SheetTab {
  kind: 'sheet';
  id: string;
  label: string;
  icon: LucideIcon;
  /** The sheet grows out of its own button: anchored to that side of the bar. */
  /** Anchored to the bar's left/right edge, or centred over its own button (inner tabs). */
  side: 'left' | 'right' | 'center';
  groups: NavItem[][];
  /** Other pages that belong to this tab (reached from elsewhere, e.g. the dashboard). */
  routes?: string[];
  /** Owns every page no other tab claims. */
  fallback?: boolean;
  /** Red counter on the icon: feeds at or below their minimum (or empty). */
  badge?: 'low-feed';
}

export interface LinkTab {
  kind: 'link';
  to: string;
  label: string;
  icon: LucideIcon;
}

export type Tab = SheetTab | LinkTab;

const farmer = (role: UserRole) => role === 'FARMER';
const everyone = () => true;

const PROFILE: NavItem = { to: '/profile', label: 'Profil va sozlamalar', icon: UserRound, color: '#30b0c7', visible: everyone };

export const OMBOR: NavItem[] = [
  { to: '/feed', label: 'Yem ombori', icon: Warehouse, color: '#a2845e', visible: farmer },
  { to: '/feed-calculator', label: 'Yem hisoblagich', icon: Calculator, color: '#34c759', visible: farmer },
];

export const DORIXONA: NavItem[] = [
  { to: '/medicines', label: 'Dori ombori', icon: Pill, color: '#ff2d55', visible: farmer },
  { to: '/diseases', label: 'Molim kasal', icon: Stethoscope, color: '#ff9500', visible: farmer },
];

export const MORE: NavItem[] = [
  { to: '/animals', label: 'Hayvonlar', icon: PawPrint, color: '#ff9500', visible: farmer },
  { to: '/animal-groups', label: 'Guruhlar', icon: LayoutGrid, color: '#5856d6', visible: farmer },
  { to: '/reports', label: 'Hisobot', icon: ChartColumn, color: '#af52de', visible: farmer },
];

const FARMER_ACCOUNT: NavItem[] = [
  { to: '/farms', label: 'Fermalarim', icon: Tractor, color: '#007aff', visible: farmer },
  PROFILE,
];

const FARMER_TABS: Tab[] = [
  {
    kind: 'sheet',
    id: 'ombor',
    label: 'Ombor',
    icon: Archive,
    side: 'left',
    groups: [OMBOR],
    badge: 'low-feed',
  },
  { kind: 'link', to: '/dashboard', label: 'Bosh sahifa', icon: House },
  { kind: 'sheet', id: 'dorixona', label: 'Dorixona', icon: Pill, side: 'center', groups: [DORIXONA] },
  {
    kind: 'sheet',
    id: 'more',
    label: 'Boshqa',
    icon: CircleEllipsis,
    side: 'right',
    groups: [MORE, FARMER_ACCOUNT],
    fallback: true,
  },
];

const ADMINISTRATION: NavItem[] = [
  { to: '/admin/users', label: 'Foydalanuvchilar', icon: Users, color: '#007aff', visible: can.viewUsers },
  { to: '/admin/roles', label: 'Rollar', icon: ShieldCheck, color: '#5856d6', visible: can.viewUsers },
  { to: '/admin/audit-logs', label: 'Audit loglar', icon: ScrollText, color: '#8e8e93', visible: can.viewAuditLogs },
];

const STAFF_MORE: NavItem[] = [
  { to: '/admin/medicines', label: 'Dorilar katalogi', icon: Pill, color: '#ff2d55', visible: can.useStaffApp },
  { to: '/admin/settings', label: 'Sozlamalar', icon: Settings, color: '#8e8e93', visible: can.manageUsers },
];

function staffTabs(role: UserRole): Tab[] {
  return [
    { kind: 'sheet', id: 'admin', label: 'Boshqaruv', icon: Shield, side: 'left', groups: [ADMINISTRATION] },
    { kind: 'link', to: roleHome(role), label: 'Bosh sahifa', icon: House },
    {
      kind: 'sheet',
      id: 'more',
      label: 'Boshqa',
      icon: CircleEllipsis,
      side: 'right',
      groups: [STAFF_MORE, [PROFILE]],
      fallback: true,
    },
  ];
}

/**
 * Tabs for the signed-in role: hidden rows and the home page (already its
 * own tab) are dropped, and so are sheets left without rows.
 */
export function navigationFor(role: UserRole): Tab[] {
  const tabs = role === 'FARMER' ? FARMER_TABS : staffTabs(role);
  const home = roleHome(role);
  return tabs.flatMap((tab): Tab[] => {
    if (tab.kind === 'link') return [tab];
    const groups = tab.groups
      .map((group) => group.filter((item) => item.visible(role) && item.to !== home))
      .filter((group) => group.length > 0);
    return groups.length > 0 ? [{ ...tab, groups }] : [];
  });
}

/** `/feed` matches `/feed` and `/feed/123`, never `/feed-calculator`. */
export function matchesPath(pathname: string, to: string): boolean {
  return pathname === to || pathname.startsWith(`${to}/`);
}

/**
 * Tab that owns `pathname`: the home link on an exact match, a sheet when
 * one of its rows (or extra routes) matches, otherwise the fallback sheet.
 * -1 when nothing fits (no fallback).
 */
export function tabIndexFor(tabs: Tab[], pathname: string): number {
  const owner = tabs.findIndex((tab) =>
    tab.kind === 'link'
      ? pathname === tab.to
      : [...tab.groups.flat().map((item) => item.to), ...(tab.routes ?? [])].some((to) => matchesPath(pathname, to)),
  );
  return owner !== -1 ? owner : tabs.findIndex((tab) => tab.kind === 'sheet' && tab.fallback === true);
}
