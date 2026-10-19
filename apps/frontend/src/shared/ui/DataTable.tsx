import { ChevronRight } from 'lucide-react';
import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { useIsDesktop } from '@/shared/hooks/useMediaQuery';
import { cn } from '@/shared/lib/cn';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  /** Right-align numbers. */
  align?: 'left' | 'right';
  className?: string;
  /** Hidden in the mobile card layout (keep cards short). */
  hideOnMobile?: boolean;
  /** Mobile cards: render below the details as a full-width row (e.g. action buttons). */
  mobileFooter?: boolean;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Accessible caption (visually hidden). */
  caption: string;
  onRowClick?: (row: T) => void;
  /** Title line of a mobile card; defaults to the first column. */
  mobileTitle?: (row: T) => ReactNode;
  rowClassName?: (row: T) => string | undefined;
}

/** Clicks on links/buttons inside a row must not also open the row. */
function fromInteractiveChild(event: MouseEvent): boolean {
  const interactive = (event.target as HTMLElement).closest('a, button, input, select, textarea, label');
  return interactive !== null && interactive !== event.currentTarget && event.currentTarget.contains(interactive);
}

/**
 * Table on desktop, stacked cards on phones — one DOM at a time so screen
 * readers never get both.
 */
export function DataTable<T>({ columns, rows, rowKey, caption, onRowClick, mobileTitle, rowClassName }: DataTableProps<T>) {
  const isDesktop = useIsDesktop();

  function onKeyDown(event: KeyboardEvent, row: T): void {
    // Keys pressed on a button inside the row belong to that button.
    if (event.target !== event.currentTarget) return;
    if (onRowClick && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      onRowClick(row);
    }
  }

  function onClick(event: MouseEvent, row: T): void {
    if (!onRowClick || fromInteractiveChild(event)) return;
    onRowClick(row);
  }

  if (!isDesktop) {
    const [first, ...rest] = columns;
    const renderCard = (row: T) => (
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-ink">{mobileTitle ? mobileTitle(row) : first?.cell(row)}</div>
        <dl className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1.5">
          {(mobileTitle ? columns : rest)
            .filter((column) => !column.hideOnMobile && !column.mobileFooter)
            .map((column) => (
              <div key={column.key} className="min-w-0">
                <dt className="text-[12px] text-ink-secondary">{column.header}</dt>
                <dd className="text-sm break-words text-ink">{column.cell(row)}</dd>
              </div>
            ))}
        </dl>
        {columns
          .filter((column) => column.mobileFooter && !column.hideOnMobile)
          .map((column) => (
            <div key={column.key} className="mt-3">
              {column.cell(row)}
            </div>
          ))}
      </div>
    );
    return (
      <ul aria-label={caption} className="flex flex-col divide-y divide-line">
        {rows.map((row) => (
          <li key={rowKey(row)} className={rowClassName?.(row)}>
            {onRowClick ? (
              <div
                role="button"
                tabIndex={0}
                onClick={(event) => onClick(event, row)}
                onKeyDown={(event) => onKeyDown(event, row)}
                className="flex items-start gap-3 px-4 py-3.5 active:bg-primary-light/50"
              >
                {renderCard(row)}
                <ChevronRight aria-hidden className="mt-1 size-5 shrink-0 text-ink-secondary" />
              </div>
            ) : (
              <div className="flex items-start gap-3 px-4 py-3.5">{renderCard(row)}</div>
            )}
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-[15px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line bg-background/60">
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                className={cn(
                  'px-4 py-3 text-[13px] font-semibold whitespace-nowrap text-ink-secondary',
                  column.align === 'right' && 'text-right',
                  column.className,
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              tabIndex={onRowClick ? 0 : undefined}
              onClick={onRowClick ? (event) => onClick(event, row) : undefined}
              onKeyDown={onRowClick ? (event) => onKeyDown(event, row) : undefined}
              className={cn(
                'border-b border-line last:border-b-0',
                onRowClick && 'cursor-pointer hover:bg-primary-light/40 focus-visible:bg-primary-light/40',
                rowClassName?.(row),
              )}
            >
              {columns.map((column) => (
                <td
                  key={column.key}
                  className={cn(
                    'px-4 py-3 align-middle text-ink',
                    column.align === 'right' && 'text-right tabular',
                    column.className,
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
