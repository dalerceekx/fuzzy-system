import { applyDecorators } from '@nestjs/common';
import { IsIn, IsString, MaxLength } from 'class-validator';

export type SortDirection = 'asc' | 'desc';

export const SORT_PARAM_MAX_LENGTH = 64;

/** Allowed values of a `sort` query param: '<field>' or '-<field>'. */
export function sortParamValues(allowed: readonly string[]): string[] {
  return allowed.flatMap((field) => [field, `-${field}`]);
}

/**
 * `sort` query param validator: '<field>' (ascending) or '-<field>'
 * (descending), where field must be in `allowed`. Combine with @IsOptional().
 */
export function IsSortParam(allowed: readonly string[]): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MaxLength(SORT_PARAM_MAX_LENGTH),
    IsIn(sortParamValues(allowed)),
  );
}

/**
 * Maps a validated `sort` value to a Prisma `orderBy` list. The mapping is
 * static code — user input only selects one of its keys and never reaches
 * Prisma directly. Unknown keys fall back to `fallback`.
 */
export function buildOrderBy<T extends string>(
  sort: string | undefined,
  mapping: Record<T, (dir: SortDirection) => object>,
  fallback: object,
): object[] {
  if (!sort) return [fallback];
  const direction: SortDirection = sort.startsWith('-') ? 'desc' : 'asc';
  const field = direction === 'desc' ? sort.slice(1) : sort;
  if (!Object.hasOwn(mapping, field)) return [fallback];
  return [mapping[field as T](direction)];
}
