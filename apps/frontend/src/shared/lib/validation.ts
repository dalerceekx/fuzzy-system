import { z } from 'zod';
import { Decimal } from './decimal';
import { normalizeUzPhone } from './phone';

/** Shared Zod building blocks with Uzbek messages. */

export const requiredText = (message: string, max: number) =>
  z.string().trim().min(1, message).max(max, `Ko‘pi bilan ${max} ta belgi`);

export const optionalText = (max: number) => z.string().trim().max(max, `Ko‘pi bilan ${max} ta belgi`);

export const phoneSchema = z
  .string()
  .trim()
  .min(1, 'Telefon raqamini kiriting')
  .refine((value) => normalizeUzPhone(value) !== null, 'Raqamni +998 90 123 45 67 ko‘rinishida kiriting');

/**
 * Mirrors the backend password policy: 8–128 characters with at least one
 * letter and one digit. The server re-validates.
 */
export const newPasswordSchema = z
  .string()
  .min(8, 'Parol kamida 8 ta belgidan iborat bo‘lsin')
  .max(128, 'Parol ko‘pi bilan 128 ta belgi')
  .regex(/\p{L}/u, 'Parolda kamida bitta harf bo‘lsin')
  .regex(/\d/, 'Parolda kamida bitta raqam bo‘lsin');

export const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, '6 xonali kodni kiriting');

export interface DecimalRule {
  maxIntegerDigits: number;
  maxFractionDigits: number;
  /** Must be strictly greater than zero. */
  positive?: boolean;
  max?: string;
}

/** Validation message for a decimal input, or null when it is acceptable. */
export function decimalProblem(
  value: string,
  { maxIntegerDigits, maxFractionDigits, positive = false, max }: DecimalRule,
): string | null {
  const parsed = Decimal.parse(value);
  if (!parsed || parsed.isNegative()) return 'Musbat son kiriting (masalan 12,5)';
  if (parsed.significantScale() > maxFractionDigits) {
    return maxFractionDigits === 0 ? 'Butun son kiriting' : `Verguldan keyin ko‘pi bilan ${maxFractionDigits} ta raqam`;
  }
  const integerDigits = parsed.toString().split('.')[0] ?? '';
  if (integerDigits.length > maxIntegerDigits) return 'Qiymat juda katta';
  if (positive && parsed.isZero()) return 'Qiymat noldan katta bo‘lsin';
  if (max && parsed.gt(Decimal.from(max))) return `Qiymat ${max} dan oshmasin`;
  return null;
}

/** Canonical API form of a valid decimal input ("1 234,50" → "1234.5"). */
export function normalizeDecimal(value: string): string {
  return Decimal.from(value).toString();
}

/**
 * Decimal input kept as a string (the API rejects JSON numbers for
 * decimals). Accepts "1 234,5" and normalizes to "1234.5".
 */
export function decimalString(rule: DecimalRule) {
  return z
    .string()
    .trim()
    .min(1, 'Qiymatni kiriting')
    .transform((value, context) => {
      const problem = decimalProblem(value, rule);
      if (problem) {
        context.addIssue({ code: 'custom', message: problem });
        return z.NEVER;
      }
      return normalizeDecimal(value);
    });
}

/**
 * Same as decimalString but an empty input means "not provided". (No
 * z.union: a union would replace the Uzbek message with a generic one.)
 */
export function optionalDecimalString(rule: DecimalRule) {
  return z
    .string()
    .trim()
    .transform((value, context) => {
      if (value === '') return undefined;
      const problem = decimalProblem(value, rule);
      if (problem) {
        context.addIssue({ code: 'custom', message: problem });
        return z.NEVER;
      }
      return normalizeDecimal(value);
    })
    .optional();
}
