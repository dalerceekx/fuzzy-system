import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, ValidateBy, ValidateIf } from 'class-validator';
import { isValidDateOnly } from '../../common/time.js';
import type { DecimalStringOptions } from '../../common/validation/index.js';

/** inventory_items.unit_price: Decimal(16, 2), ≥ 0. */
export const UNIT_PRICE: DecimalStringOptions = {
  maxIntegerDigits: 14,
  maxFractionDigits: 2,
  min: '0',
};

/** inventory_items.min_quantity: Decimal(14, 3), ≥ 0. */
export const MIN_QUANTITY: DecimalStringOptions = {
  maxIntegerDigits: 11,
  maxFractionDigits: 3,
  min: '0',
};

/** First stock of a new item (an IN movement): Decimal(14, 3), > 0. */
export const INITIAL_QUANTITY: DecimalStringOptions = {
  maxIntegerDigits: 11,
  maxFractionDigits: 3,
  min: '0',
  minExclusive: true,
};

/** 'YYYY-MM-DD' calendar date (impossible dates such as 2026-02-30 rejected). */
export function IsDateOnly(): PropertyDecorator {
  return applyDecorators(
    IsString(),
    MaxLength(10),
    ValidateBy({
      name: 'isDateOnly',
      validator: {
        validate: (value: unknown) =>
          typeof value === 'string' && isValidDateOnly(value),
        defaultMessage: () =>
          '$property YYYY-MM-DD formatidagi sana bo‘lishi kerak',
      },
    }),
  );
}

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
