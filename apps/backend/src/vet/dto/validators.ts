import { Transform } from 'class-transformer';
import { ValidateIf } from 'class-validator';

/**
 * Optional field that may be omitted but never sent as `null` (IsOptional
 * would let `null` through).
 */
export function OptionalNotNull(): PropertyDecorator {
  return ValidateIf((_object, value) => value !== undefined);
}

/** Optional field where `null` explicitly clears the stored value (PATCH). */
export function OptionalNullable(): PropertyDecorator {
  return ValidateIf((_object, value) => value !== undefined && value !== null);
}

/** Query-string boolean: only the literals 'true' / 'false'. */
export function QueryBoolean(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  );
}
