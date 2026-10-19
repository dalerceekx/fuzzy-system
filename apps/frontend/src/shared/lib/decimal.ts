/**
 * Exact fixed-point decimal arithmetic on BigInt.
 *
 * Quantities and money travel as decimal strings ("12.500", "2500.00") —
 * the backend stores them as Postgres NUMERIC and rejects JS numbers. They
 * are never converted to floating point for arithmetic; `toNumber()` exists
 * only for chart rendering.
 */
const PLAIN_DECIMAL = /^-?\d+(\.\d+)?$/;

function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

/** Integer division rounding half away from zero. */
function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new RangeError('Nolga bo‘lish mumkin emas');
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  if (remainder === 0n) return quotient;
  const negative = numerator < 0n !== denominator < 0n;
  return absBigInt(remainder) * 2n >= absBigInt(denominator) ? quotient + (negative ? -1n : 1n) : quotient;
}

export class Decimal {
  /** value = units / 10^scale */
  private constructor(
    readonly units: bigint,
    readonly scale: number,
  ) {}

  static readonly ZERO = new Decimal(0n, 0);

  /**
   * Parses user or API input. Accepts "1234", "-1.5", "1 234,5" (spaces and a
   * decimal comma, as typed in Uzbek locale). Rejects exponents, "+", "NaN",
   * empty strings and anything else ambiguous.
   */
  static parse(input: string | null | undefined): Decimal | null {
    if (input === null || input === undefined) return null;
    const normalized = input.replace(/[\s  ]/g, '').replace(',', '.');
    if (!PLAIN_DECIMAL.test(normalized)) return null;
    const negative = normalized.startsWith('-');
    const unsigned = negative ? normalized.slice(1) : normalized;
    const [integerPart = '0', fractionPart = ''] = unsigned.split('.');
    const units = BigInt(integerPart + fractionPart) * (negative ? -1n : 1n);
    return new Decimal(units, fractionPart.length);
  }

  /** Like `parse`, but throws on invalid input. Numbers must be safe integers. */
  static from(input: Decimal | string | bigint | number): Decimal {
    if (input instanceof Decimal) return input;
    if (typeof input === 'bigint') return new Decimal(input, 0);
    if (typeof input === 'number') {
      if (!Number.isSafeInteger(input)) {
        throw new TypeError('Kasr sonlar Decimal ga satr ko‘rinishida beriladi');
      }
      return new Decimal(BigInt(input), 0);
    }
    const parsed = Decimal.parse(input);
    if (!parsed) throw new TypeError(`Noto‘g‘ri son: ${input}`);
    return parsed;
  }

  static sum(values: Iterable<Decimal>): Decimal {
    let total = Decimal.ZERO;
    for (const value of values) total = total.add(value);
    return total;
  }

  private rescaled(scale: number): bigint {
    return scale >= this.scale ? this.units * pow10(scale - this.scale) : divideHalfUp(this.units, pow10(this.scale - scale));
  }

  add(other: Decimal): Decimal {
    const scale = Math.max(this.scale, other.scale);
    return new Decimal(this.rescaled(scale) + other.rescaled(scale), scale);
  }

  sub(other: Decimal): Decimal {
    const scale = Math.max(this.scale, other.scale);
    return new Decimal(this.rescaled(scale) - other.rescaled(scale), scale);
  }

  mul(other: Decimal): Decimal {
    return new Decimal(this.units * other.units, this.scale + other.scale);
  }

  /** Division rounded half-up to `resultScale` fraction digits. */
  div(other: Decimal, resultScale: number): Decimal {
    if (other.isZero()) throw new RangeError('Nolga bo‘lish mumkin emas');
    const numerator = this.units * pow10(other.scale + resultScale);
    const denominator = other.units * pow10(this.scale);
    return new Decimal(divideHalfUp(numerator, denominator), resultScale);
  }

  compare(other: Decimal): -1 | 0 | 1 {
    const scale = Math.max(this.scale, other.scale);
    const a = this.rescaled(scale);
    const b = other.rescaled(scale);
    return a === b ? 0 : a < b ? -1 : 1;
  }

  gt(other: Decimal): boolean {
    return this.compare(other) > 0;
  }

  gte(other: Decimal): boolean {
    return this.compare(other) >= 0;
  }

  lt(other: Decimal): boolean {
    return this.compare(other) < 0;
  }

  isZero(): boolean {
    return this.units === 0n;
  }

  isNegative(): boolean {
    return this.units < 0n;
  }

  /** Rounds half away from zero to `scale` fraction digits. */
  round(scale: number): Decimal {
    return new Decimal(this.rescaled(scale), scale);
  }

  /** Fraction digits actually needed (trailing zeros ignored). */
  significantScale(): number {
    let units = this.units;
    let scale = this.scale;
    while (scale > 0 && units % 10n === 0n) {
      units /= 10n;
      scale -= 1;
    }
    return scale;
  }

  /** Plain string with exactly `scale` fraction digits ("1234.50"). */
  toFixed(scale: number): string {
    const units = this.rescaled(scale);
    const negative = units < 0n;
    const digits = absBigInt(units)
      .toString()
      .padStart(scale + 1, '0');
    const integerPart = digits.slice(0, digits.length - scale);
    const fractionPart = scale > 0 ? `.${digits.slice(digits.length - scale)}` : '';
    return `${negative ? '-' : ''}${integerPart}${fractionPart}`;
  }

  /** Canonical plain string without trailing fraction zeros ("12.5"). */
  toString(): string {
    return this.toFixed(this.significantScale());
  }

  /** Lossy; for chart geometry only, never for arithmetic. */
  toNumber(): number {
    return Number(this.toString());
  }
}

/** Parses an API decimal string; malformed values become zero. */
export function decimalOrZero(value: string | null | undefined): Decimal {
  return Decimal.parse(value) ?? Decimal.ZERO;
}
