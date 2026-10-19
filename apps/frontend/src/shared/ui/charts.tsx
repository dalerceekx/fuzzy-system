import type { ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';

/**
 * Categorical chart colors, fixed order, never cycled. Validated with the
 * dataviz palette checker on the white card surface (light mode only — the
 * app has no dark theme): lightness band, chroma floor, adjacent CVD ΔE ≥ 8,
 * normal-vision ΔE ≥ 15 and ≥ 3:1 contrast all pass. Status colors are not
 * reused for series.
 */
export const CHART_COLORS = ['#b07a12', '#2f6ea5', '#1e9e78', '#8a5cc2'] as const;

const AXIS_TEXT = { fill: 'var(--text-secondary)', fontSize: 12 };
const GRID = 'var(--border)';

export interface ChartSeries {
  key: string;
  label: string;
}

interface TooltipEntry {
  name?: string | number;
  value?: unknown;
  color?: string;
  dataKey?: string | number;
}

interface ChartTooltipProps {
  active?: boolean;
  label?: string | number;
  payload?: readonly TooltipEntry[];
  formatValue: (value: number) => string;
}

/** Tooltip text stays in ink tokens; the color swatch carries identity. */
function ChartTooltip({ active, label, payload, formatValue }: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="rounded-[10px] border border-line bg-card px-3 py-2 text-sm shadow-[0_6px_18px_rgba(45,41,31,0.10)]">
      <p className="mb-1 font-semibold text-ink">{label}</p>
      <ul className="flex flex-col gap-0.5">
        {payload.map((entry) => (
          <li key={String(entry.dataKey ?? entry.name)} className="flex items-center gap-2 text-ink-secondary">
            <span aria-hidden className="inline-block size-2.5 rounded-[3px]" style={{ backgroundColor: entry.color }} />
            <span className="flex-1">{entry.name}</span>
            <span className="font-medium text-ink tabular">{formatValue(Number(entry.value ?? 0))}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type ChartRow = Record<string, string | number>;

interface BarChartViewProps {
  data: ChartRow[];
  /** Field holding the category label on the x axis. */
  categoryKey: string;
  series: ChartSeries[];
  /** Formats numbers in tooltips (and ticks unless `formatAxis` is given). */
  formatValue: (value: number) => string;
  /** Shorter tick labels, e.g. "6,5 mln". */
  formatAxis?: (value: number) => string;
  /** Stack multiple series in one bar (parts of a whole). */
  stacked?: boolean;
  height?: number;
  /** Accessible name of the chart; the table view below carries the numbers. */
  label: string;
}

/**
 * Thin, rounded bars on a recessive grid with a hover tooltip. Numbers are
 * for geometry only — callers compute them from exact decimals and show
 * exact values in the table view.
 */
export function BarChartView({
  data,
  categoryKey,
  series,
  formatValue,
  formatAxis = formatValue,
  stacked = false,
  height = 260,
  label,
}: BarChartViewProps) {
  return (
    <div role="img" aria-label={label} style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }} barCategoryGap="28%">
          <CartesianGrid vertical={false} stroke={GRID} />
          <XAxis dataKey={categoryKey} tickLine={false} axisLine={{ stroke: GRID }} tick={AXIS_TEXT} interval={0} />
          <YAxis
            tickLine={false}
            axisLine={false}
            tick={AXIS_TEXT}
            width={72}
            tickFormatter={(value: number) => formatAxis(value)}
          />
          <Tooltip
            cursor={{ fill: 'rgba(233, 196, 106, 0.18)' }}
            content={(props) => (
              <ChartTooltip
                active={props.active}
                label={props.label as string | number | undefined}
                payload={props.payload as readonly TooltipEntry[] | undefined}
                formatValue={formatValue}
              />
            )}
          />
          {series.length > 1 ? (
            <Legend
              iconType="square"
              wrapperStyle={{ fontSize: 13 }}
              formatter={(value: string) => <span style={{ color: 'var(--text-secondary)' }}>{value}</span>}
            />
          ) : null}
          {series.map((entry, index) => (
            <Bar
              key={entry.key}
              dataKey={entry.key}
              name={entry.label}
              fill={CHART_COLORS[index % CHART_COLORS.length]}
              stackId={stacked ? 'stack' : undefined}
              maxBarSize={40}
              // 2px surface gap between stacked segments and adjacent bars.
              stroke="var(--card-background)"
              strokeWidth={stacked ? 2 : 0}
              radius={stacked && index < series.length - 1 ? 0 : [4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export interface BarListItem {
  key: string;
  label: ReactNode;
  /** Geometry only. */
  value: number;
  /** Exact, formatted value shown as text. */
  display: string;
}

/**
 * Horizontal share bars with the exact value as text — readable for long
 * category names where vertical bars would collide. `max` defaults to the
 * largest value; pass the total to show shares of a whole.
 */
export function BarList({ items, label, max }: { items: BarListItem[]; label: string; max?: number }) {
  const scale = Math.max(1, max ?? Math.max(0, ...items.map((item) => item.value)));
  return (
    <ul aria-label={label} className="flex flex-col gap-3">
      {items.map((item) => (
        <li key={item.key}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium text-ink">{item.label}</span>
            <span className="text-ink-secondary tabular">{item.display}</span>
          </div>
          <div aria-hidden className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-neutral-light">
            <div
              className="h-full rounded-full"
              style={{ width: `${Math.min(100, (item.value / scale) * 100)}%`, backgroundColor: CHART_COLORS[0] }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/** Collapsible exact-number table under every chart (accessibility + precision). */
export function ChartTable({ caption, headers, rows }: { caption: string; headers: string[]; rows: ReactNode[][] }) {
  return (
    <details className="mt-3 rounded-[10px] border border-line">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-ink-secondary hover:text-ink">
        Jadval ko‘rinishida
      </summary>
      <div className="overflow-x-auto border-t border-line">
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {headers.map((header, index) => (
                <th
                  key={header}
                  scope="col"
                  className={
                    index === 0
                      ? 'px-3 py-2 text-left font-semibold text-ink-secondary'
                      : 'px-3 py-2 text-right font-semibold text-ink-secondary'
                  }
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-t border-line">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className={cellIndex === 0 ? 'px-3 py-2 text-left' : 'px-3 py-2 text-right tabular'}>
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
