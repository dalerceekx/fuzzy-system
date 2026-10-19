import { describe, expect, it } from 'vitest';
import { Decimal } from './decimal';
import { formatCompact, formatDate, formatDecimal, formatMoney, initials } from './format';
import { formatPhone, normalizeUzPhone } from './phone';

const d = (value: string) => Decimal.from(value);

describe('Decimal', () => {
  it('parses plain and Uzbek-formatted input', () => {
    expect(Decimal.parse('12.5')?.toString()).toBe('12.5');
    expect(Decimal.parse('1 234,50')?.toString()).toBe('1234.5');
    expect(Decimal.parse('-0.001')?.toString()).toBe('-0.001');
  });

  it.each(['', '1e5', '+1', '.5', '1.', 'NaN', 'abc', '1,2,3', '--1'])('rejects %s', (input) => {
    expect(Decimal.parse(input)).toBeNull();
  });

  it('adds, subtracts and multiplies exactly (no float drift)', () => {
    expect(d('0.1').add(d('0.2')).toString()).toBe('0.3');
    expect(d('1250.000').sub(d('0.001')).toFixed(3)).toBe('1249.999');
    expect(d('10').mul(d('8')).mul(d('30')).toString()).toBe('2400');
    expect(d('2400').mul(d('2500')).toString()).toBe('6000000');
    expect(d('0.07').mul(d('100')).toString()).toBe('7');
  });

  it('rounds half away from zero', () => {
    expect(d('1.005').round(2).toFixed(2)).toBe('1.01');
    expect(d('-1.005').round(2).toFixed(2)).toBe('-1.01');
    expect(d('2.444').round(2).toFixed(2)).toBe('2.44');
  });

  it('divides with a fixed result scale', () => {
    expect(d('1250').div(d('80'), 3).toString()).toBe('15.625');
    expect(d('1').div(d('3'), 4).toString()).toBe('0.3333');
    expect(() => d('1').div(Decimal.ZERO, 2)).toThrow('Nolga bo‘lish mumkin emas');
  });

  it('compares across scales', () => {
    expect(d('1.50').compare(d('1.5'))).toBe(0);
    expect(d('2').gt(d('1.999'))).toBe(true);
    expect(d('0.000').isZero()).toBe(true);
  });

  it('refuses fractional JS numbers', () => {
    expect(() => Decimal.from(0.1)).toThrow('Kasr sonlar Decimal ga satr ko‘rinishida beriladi');
    expect(Decimal.from(42).toString()).toBe('42');
  });
});

describe('formatting', () => {
  it('groups digits with a no-break space and uses a decimal comma', () => {
    expect(formatDecimal('2400')).toBe('2 400');
    expect(formatDecimal('1234567.891')).toBe('1 234 567,891');
    expect(formatDecimal('12.3456', { maxFractionDigits: 2 })).toBe('12,35');
    expect(formatDecimal(null)).toBe('—');
  });

  it('formats UZS amounts', () => {
    expect(formatMoney('6000000')).toBe('6 000 000 so‘m');
    expect(formatMoney('2500.50')).toBe('2 500,5 so‘m');
  });

  it('compacts axis labels', () => {
    expect(formatCompact(6_500_000)).toBe('6,5 mln');
    expect(formatCompact(12_000)).toBe('12 ming');
    expect(formatCompact(950)).toBe('950');
  });

  it('formats calendar dates without time-zone shifts', () => {
    expect(formatDate('2026-10-16')).toBe('16.10.2026');
    expect(formatDate('2026-10-15T20:30:00.000Z')).toBe('16.10.2026');
  });

  it('builds avatar initials', () => {
    expect(initials('Demo Fermer')).toBe('DF');
    expect(initials('')).toBe('?');
  });
});

describe('phone numbers', () => {
  it.each([
    ['+998 90 123-45-67', '+998901234567'],
    ['998901234567', '+998901234567'],
    ['901234567', '+998901234567'],
  ])('normalizes %s', (input, expected) => {
    expect(normalizeUzPhone(input)).toBe(expected);
  });

  it.each(['+7 900 123 45 67', '12345', '+99890123456', 'abc'])('rejects %s', (input) => {
    expect(normalizeUzPhone(input)).toBeNull();
  });

  it('formats for display', () => {
    expect(formatPhone('+998901234567')).toBe('+998 90 123 45 67');
  });
});
