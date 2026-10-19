import { describe, expect, it } from 'vitest';
import { decimalString, newPasswordSchema, optionalDecimalString, phoneSchema } from './validation';

describe('decimalString', () => {
  const weight = decimalString({ maxIntegerDigits: 4, maxFractionDigits: 2, positive: true, max: '5000' });

  it('normalizes accepted input to the API format', () => {
    expect(weight.parse('450,5')).toBe('450.5');
    expect(weight.parse(' 1 200 ')).toBe('1200');
  });

  it.each([
    ['', 'Qiymatni kiriting'],
    ['-3', 'Musbat son kiriting (masalan 12,5)'],
    ['12.345', 'Verguldan keyin ko‘pi bilan 2 ta raqam'],
    ['0', 'Qiymat noldan katta bo‘lsin'],
    ['5000.01', 'Qiymat 5000 dan oshmasin'],
    ['1e3', 'Musbat son kiriting (masalan 12,5)'],
  ])('rejects %s', (input, message) => {
    const result = weight.safeParse(input);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(message);
  });

  it('treats an empty optional field as not provided', () => {
    const schema = optionalDecimalString({ maxIntegerDigits: 4, maxFractionDigits: 2 });
    expect(schema.parse('')).toBeUndefined();
    expect(schema.parse('7,25')).toBe('7.25');
    expect(schema.safeParse('7,255').error?.issues[0]?.message).toBe('Verguldan keyin ko‘pi bilan 2 ta raqam');
  });
});

describe('password policy (mirrors the backend)', () => {
  it.each(['short1', 'onlyletters', '12345678', 'x'.repeat(129) + '1'])('rejects %s', (value) => {
    expect(newPasswordSchema.safeParse(value).success).toBe(false);
  });

  it('accepts letters + digits, 8–128 chars', () => {
    expect(newPasswordSchema.safeParse('Fermer2026').success).toBe(true);
    expect(newPasswordSchema.safeParse('o‘zbek123').success).toBe(true);
  });
});

describe('phoneSchema', () => {
  it('accepts formatted Uzbek numbers', () => {
    expect(phoneSchema.safeParse('+998 90 123 45 67').success).toBe(true);
  });

  it('rejects other numbers', () => {
    expect(phoneSchema.safeParse('+7 900 000 00 00').success).toBe(false);
  });
});
