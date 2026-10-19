import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { Link } from 'react-router';
import { cn } from '@/shared/lib/cn';

export type MenuItem =
  | { kind: 'link'; label: string; icon?: ReactNode; to: string }
  | { kind: 'action'; label: string; icon?: ReactNode; onSelect: () => void; tone?: 'default' | 'danger' }
  | { kind: 'separator' };

interface MenuProps {
  /** Renders the trigger; spread `triggerProps` onto a <button>. */
  trigger: (triggerProps: {
    id: string;
    'aria-haspopup': 'menu';
    'aria-expanded': boolean;
    'aria-controls': string;
    onClick: () => void;
    onKeyDown: (event: KeyboardEvent) => void;
    ref: Ref<HTMLButtonElement>;
  }) => ReactNode;
  items: MenuItem[];
  header?: ReactNode;
  align?: 'start' | 'end';
  label: string;
}

const ITEM_CLASS =
  'flex min-h-11 w-full items-center gap-3 rounded-[8px] px-3 text-left text-[15px] text-ink transition-colors hover:bg-primary-light focus:bg-primary-light focus:outline-none';

/**
 * Accessible dropdown menu (WAI-ARIA menu button pattern): arrow keys move
 * between items, Escape closes and returns focus, outside clicks close.
 */
export function Menu({ trigger, items, header, align = 'end', label }: MenuProps) {
  const [open, setOpen] = useState(false);
  const triggerId = useId();
  const menuId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  const menuItems = useCallback(() => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []), []);

  const focusItem = useCallback(
    (index: number) => {
      const elements = menuItems();
      if (elements.length === 0) return;
      elements[(index + elements.length) % elements.length]?.focus();
    },
    [menuItems],
  );

  useEffect(() => {
    if (!open) return undefined;
    focusItem(0);
    function onPointerDown(event: PointerEvent): void {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close(false);
    }
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open, close, focusItem]);

  function onMenuKeyDown(event: KeyboardEvent): void {
    const elements = menuItems();
    const current = elements.indexOf(document.activeElement as HTMLElement);
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        focusItem(current + 1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        focusItem(current - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusItem(0);
        break;
      case 'End':
        event.preventDefault();
        focusItem(elements.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
      default:
        break;
    }
  }

  return (
    <div ref={rootRef} className="relative">
      {trigger({
        id: triggerId,
        'aria-haspopup': 'menu',
        'aria-expanded': open,
        'aria-controls': menuId,
        onClick: () => setOpen((value) => !value),
        onKeyDown: (event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen(true);
          }
        },
        ref: triggerRef,
      })}
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          tabIndex={-1}
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={cn(
            'absolute top-full z-40 mt-2 w-64 rounded-[12px] border border-line bg-card p-1.5 shadow-[0_8px_24px_rgba(45,41,31,0.08)]',
            align === 'end' ? 'right-0' : 'left-0',
          )}
        >
          {header ? <div className="border-b border-line px-3 pt-2 pb-3">{header}</div> : null}
          <div className={header ? 'pt-1.5' : undefined}>
            {items.map((item, index) => {
              if (item.kind === 'separator') return <hr key={`separator-${index}`} className="my-1.5 border-line" />;
              if (item.kind === 'link') {
                return (
                  <Link
                    key={item.label}
                    role="menuitem"
                    tabIndex={-1}
                    to={item.to}
                    className={ITEM_CLASS}
                    onClick={() => close(false)}
                  >
                    <span aria-hidden className="text-ink-secondary">
                      {item.icon}
                    </span>
                    {item.label}
                  </Link>
                );
              }
              const danger = item.tone === 'danger';
              return (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  tabIndex={-1}
                  className={cn(ITEM_CLASS, danger && 'text-danger hover:bg-danger-light focus:bg-danger-light')}
                  onClick={() => {
                    close(false);
                    item.onSelect();
                  }}
                >
                  <span aria-hidden className={danger ? 'text-danger' : 'text-ink-secondary'}>
                    {item.icon}
                  </span>
                  {item.label}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
