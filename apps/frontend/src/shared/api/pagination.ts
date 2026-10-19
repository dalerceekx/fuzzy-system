import { MAX_PAGE_SIZE, type Paginated } from '@/shared/types/api';

export interface AllPagesResult<T> {
  items: T[];
  total: number;
  /** True when `maxItems` stopped the loop before reaching `total`. */
  truncated: boolean;
}

/**
 * Loads every page of a list endpoint (100 per request — the backend's
 * maximum). Used where the UI needs the whole set for client-side search
 * or aggregation; `maxItems` keeps very large farms from flooding the API.
 */
export async function fetchAllPages<T>(
  fetchPage: (page: number, limit: number) => Promise<Paginated<T>>,
  maxItems = 2_000,
): Promise<AllPagesResult<T>> {
  const items: T[] = [];
  let total = 0;
  for (let page = 1; ; page += 1) {
    const result = await fetchPage(page, MAX_PAGE_SIZE);
    total = result.total;
    items.push(...result.items);
    const exhausted = result.items.length < MAX_PAGE_SIZE || items.length >= total;
    if (exhausted) return { items, total, truncated: false };
    if (items.length >= maxItems) return { items, total, truncated: true };
  }
}

/** Runs async tasks with a concurrency limit, preserving input order. */
export async function mapWithConcurrency<T, R>(
  inputs: readonly T[],
  limit: number,
  task: (input: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(inputs.length);
  let next = 0;
  async function worker(): Promise<void> {
    while (next < inputs.length) {
      const index = next;
      next += 1;
      results[index] = await task(inputs[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, inputs.length) }, worker));
  return results;
}

/** Builds query params, dropping empty values (the backend rejects ""). */
export function cleanParams(params: Record<string, string | number | boolean | null | undefined>) {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    result[key] = value;
  }
  return result;
}
