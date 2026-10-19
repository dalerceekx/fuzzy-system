import { ValidateBy, type ValidationOptions } from 'class-validator';
import { Prisma } from '../../generated/prisma/client.js';

export const IS_DECIMAL_STRING = 'isDecimalString';

export interface DecimalStringOptions {
  maxIntegerDigits: number;
  maxFractionDigits: number;
  /** Inclusive lower bound (exclusive with `minExclusive`). */
  min?: string;
  minExclusive?: boolean;
  /** Inclusive upper bound. */
  max?: string;
}

// Plain decimal notation only: no '+', exponent, leading '.', trailing '.',
// leading zeros, whitespace, thousands separators or non-ASCII digits.
const DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]+)?$/;

export function isDecimalString(
  value: unknown,
  options: DecimalStringOptions,
): value is string {
  if (typeof value !== 'string') return false;
  const maxLength = options.maxIntegerDigits + options.maxFractionDigits + 2;
  if (value.length > maxLength || !DECIMAL.test(value)) return false;

  const unsigned = value.startsWith('-') ? value.slice(1) : value;
  const [integerPart, fractionPart = ''] = unsigned.split('.');
  if (integerPart.length > options.maxIntegerDigits) return false;
  if (fractionPart.length > options.maxFractionDigits) return false;

  const decimal = new Prisma.Decimal(value);
  if (options.min !== undefined) {
    const min = new Prisma.Decimal(options.min);
    if (options.minExclusive ? decimal.lte(min) : decimal.lt(min)) return false;
  }
  if (
    options.max !== undefined &&
    decimal.gt(new Prisma.Decimal(options.max))
  ) {
    return false;
  }
  return true;
}

/**
 * Decimal input MUST be a JSON string ("12.50"); numbers, null, NaN,
 * Infinity and exponent notation are rejected so money/stock values never
 * pass through floating point.
 */
export function IsDecimalString(
  options: DecimalStringOptions,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return ValidateBy(
    {
      name: IS_DECIMAL_STRING,
      constraints: [options],
      validator: {
        validate: (value: unknown) => isDecimalString(value, options),
        defaultMessage: () => describe(options),
      },
    },
    validationOptions,
  );
}

function describe(options: DecimalStringOptions): string {
  const bounds: string[] = [];
  if (options.min !== undefined) {
    bounds.push(`${options.minExclusive ? '>' : '≥'} ${options.min}`);
  }
  if (options.max !== undefined) bounds.push(`≤ ${options.max}`);
  return (
    `$property o‘nlik son satri bo‘lishi kerak (masalan "12.5"): ` +
    `butun qismi ≤ ${options.maxIntegerDigits} raqam, ` +
    `kasr qismi ≤ ${options.maxFractionDigits} raqam` +
    (bounds.length ? `, qiymat ${bounds.join(' va ')}` : '')
  );
}
