import {
  DEMO_PHONE_PREFIX,
  isDemoPhone,
  maskPhone,
  normalizePhone,
} from './phone.js';

describe('normalizePhone', () => {
  it.each([
    ['+998901234567', '+998901234567'],
    ['+998 90 123-45-67', '+998901234567'],
    ['+998 (90) 123 45 67', '+998901234567'],
    ['998901234567', '+998901234567'],
    ['901234567', '+998901234567'],
    ['90 123 45 67', '+998901234567'],
    ['  +998901234567  ', '+998901234567'],
    [`${DEMO_PHONE_PREFIX}001`, '+998000000001'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    '+79161234567',
    '+447911123456',
    '+99890123456',
    '+9989012345678',
    '8 90 123 45 67',
    '12345',
    '+998-90-ABC-45-67',
    '+998901234567; DROP TABLE',
    '٩٠١٢٣٤٥٦٧',
    '',
    `+998901234567${' '.repeat(40)}`,
    '++998901234567',
  ])('rejects %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it('rejects non-strings', () => {
    for (const value of [
      null,
      undefined,
      998901234567,
      {},
      ['+998901234567'],
    ]) {
      expect(normalizePhone(value)).toBeNull();
    }
  });
});

describe('isDemoPhone / maskPhone', () => {
  it('recognizes the demo range', () => {
    expect(isDemoPhone('+998000000123')).toBe(true);
    expect(isDemoPhone('+998901234567')).toBe(false);
  });

  it('masks all but the operator code and the last two digits', () => {
    expect(maskPhone('+998901234567')).toBe('+99890*****67');
    expect(maskPhone('+998000000001')).toBe('+99800*****01');
    expect(maskPhone(null)).toBe('***');
    expect(maskPhone(undefined)).toBe('***');
    expect(maskPhone('12345')).toBe('*****');
    expect(maskPhone('+998901234567')).not.toContain('1234');
  });
});
