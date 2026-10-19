import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';
import { useActiveFarm } from '@/features/farms/model/active-farm';
import { isLowStock } from '@/features/inventory/lib/stock-math';
import { useInventoryItems } from '@/features/inventory/model/inventory.queries';
import { cn } from '@/shared/lib/cn';
import type { UserRole } from '@/shared/types/api';
import { navigationFor, tabIndexFor, type SheetTab } from './navigation';

const sheetId = (id: string) => `${id}-sheet`;

/** Feeds at or below the farmer's minimum, or empty ("qoldiq nazorati"). */
function LowFeedCount({ farmId, children }: { farmId: string; children: (count: number) => ReactNode }) {
  const feed = useInventoryItems(farmId, 'FEED');
  const count = (feed.data?.items ?? []).filter((item) => isLowStock(item)).length;
  return <>{children(count)}</>;
}

function WithLowFeedCount({ children }: { children: (count: number) => ReactNode }) {
  const { activeFarm } = useActiveFarm();
  return activeFarm ? <LowFeedCount farmId={activeFarm.id}>{children}</LowFeedCount> : <>{children(0)}</>;
}

/** iOS-style list that grows out of its tab button; hidden (and inert) while closed. */
function Sheet({
  tab,
  index,
  open,
  onNavigate,
}: {
  tab: SheetTab;
  /** Position of its button: a centred sheet sits above it. */
  index: number;
  open: boolean;
  onNavigate: () => void;
}) {
  return (
    <nav
      id={sheetId(tab.id)}
      style={{ '--sheet-i': index } as CSSProperties}
      aria-label={tab.label}
      aria-hidden={!open}
      inert={!open}
      className={cn('more-sheet', tab.side !== 'right' && tab.side, open && 'open')}
    >
      {tab.groups.map((group, groupIndex) => (
        <ul key={groupIndex} className="more-group">
          {group.map((item) => (
            <li key={item.to}>
              <NavLink to={item.to} className="more-link" onClick={onNavigate}>
                <span aria-hidden className="nav-icon" style={{ background: item.color }}>
                  <item.icon />
                </span>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      ))}
    </nav>
  );
}

/**
 * Floating Telegram (iOS) style tab bar: the home link sits in the middle,
 * the other tabs open sheets. One sheet at a time; Escape, the shade, the
 * home tab and any navigation close it.
 */
export function TabBar({ role }: { role: UserRole }) {
  const { pathname } = useLocation();
  const tabs = navigationFor(role);
  // A sheet belongs to the page it was opened on: navigating closes it without an effect.
  const [sheet, setSheet] = useState<{ id: string; path: string } | null>(null);
  const openId = sheet?.path === pathname ? sheet.id : null;
  const close = () => setSheet(null);

  useEffect(() => {
    if (!openId) return;
    const panel = document.getElementById(sheetId(openId));
    panel?.querySelector<HTMLElement>('a')?.focus();
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      setSheet(null);
      document.querySelector<HTMLElement>(`[aria-controls="${sheetId(openId ?? '')}"]`)?.focus();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openId]);

  const routeIndex = tabIndexFor(tabs, pathname);
  const openIndex = tabs.findIndex((tab) => tab.kind === 'sheet' && tab.id === openId);
  // The indicator follows the open sheet, otherwise the page's own tab.
  const indicator = openIndex !== -1 ? openIndex : routeIndex;

  return (
    <>
      <div aria-hidden className={cn('more-shade', openId && 'open')} onClick={close} />
      <div className="tabbar-wrap" style={{ '--n': tabs.length } as CSSProperties}>
        <nav aria-label="Asosiy menyu" className="tabbar" style={{ '--i': Math.max(indicator, 0) } as CSSProperties}>
          {indicator !== -1 ? <span aria-hidden className="tab-indicator" /> : null}
          {tabs.map((tab, index) => {
            const active = index === indicator;
            if (tab.kind === 'link') {
              return (
                <NavLink key={tab.to} to={tab.to} end onClick={close} className={() => cn('tab', active && 'active')}>
                  <span className="tab-icon">
                    <tab.icon aria-hidden />
                  </span>
                  <span className="tab-label">{tab.label}</span>
                </NavLink>
              );
            }
            const content = (count: number) => (
              <>
                <span className="tab-icon">
                  <tab.icon aria-hidden />
                  {count > 0 ? (
                    <span aria-hidden className="tab-badge" title={`${count} ta yem kam qoldi`}>
                      {count}
                    </span>
                  ) : null}
                </span>
                <span className="tab-label">{tab.label}</span>
                {count > 0 ? <span className="sr-only">, {count} ta yem kam qoldi</span> : null}
              </>
            );
            return (
              <button
                key={tab.id}
                type="button"
                className={cn('tab', active && 'active')}
                aria-expanded={openId === tab.id}
                aria-controls={sheetId(tab.id)}
                aria-current={index === routeIndex ? 'true' : undefined}
                onClick={() => setSheet(openId === tab.id ? null : { id: tab.id, path: pathname })}
              >
                {tab.badge === 'low-feed' ? <WithLowFeedCount>{content}</WithLowFeedCount> : content(0)}
              </button>
            );
          })}
        </nav>
        {tabs.map((tab, index) =>
          tab.kind === 'sheet' ? (
            <Sheet key={tab.id} tab={tab} index={index} open={openId === tab.id} onNavigate={close} />
          ) : null,
        )}
      </div>
    </>
  );
}
