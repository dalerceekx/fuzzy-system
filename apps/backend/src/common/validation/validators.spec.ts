import { plainToInstance } from 'class-transformer';
import { IsString, MaxLength, validateSync } from 'class-validator';
import {
  isDecimalString,
  IsDecimalString,
  type DecimalStringOptions,
} from './is-decimal-string.decorator.js';
import { IsUzPhone } from './is-uz-phone.decorator.js';
import { SanitizedText } from './sanitized-text.decorator.js';

const QUANTITY: DecimalStringOptions = {
  maxIntegerDigits: 11,
  maxFractionDigits: 3,
  min: '0',
  minExclusive: true,
};

describe('isDecimalString', () => {
  it.each(['1', '0.001', '12.5', '99999999999.999', '0.5', '10'])(
    'accepts %s',
    (value) => {
      expect(isDecimalString(value, QUANTITY)).toBe(true);
    },
  );

  it.each([
    ['a number', 12.5],
    ['null', null],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['an empty string', ''],
    ['exponent', '1e3'],
    ['plus sign', '+1'],
    ['leading dot', '.5'],
    ['trailing dot', '5.'],
    ['leading zeros', '007'],
    ['whitespace', ' 1'],
    ['comma decimal', '1,5'],
    ['hex', '0x10'],
    ['"NaN" string', 'NaN'],
    ['"Infinity" string', 'Infinity'],
    ['too many fraction digits', '1.0001'],
    ['too many integer digits', '123456789012'],
    ['zero with exclusive min', '0'],
    ['negative', '-1'],
    ['non-ASCII digits', '١٢'],
    ['an object', { toString: () => '1' }],
  ])('rejects %s', (_label, value) => {
    expect(isDecimalString(value, QUANTITY)).toBe(false);
  });

  it('applies inclusive min and max', () => {
    const weight: DecimalStringOptions = {
      maxIntegerDigits: 4,
      maxFractionDigits: 2,
      min: '0',
      max: '5000',
    };
    expect(isDecimalString('0', weight)).toBe(true);
    expect(isDecimalString('5000', weight)).toBe(true);
    expect(isDecimalString('5000.01', weight)).toBe(false);
    expect(isDecimalString('-0.01', weight)).toBe(false);
  });

  it('works as a decorator with a descriptive message', () => {
    class Dto {
      @IsDecimalString(QUANTITY)
      quantity: unknown;
    }
    const ok = validateSync(plainToInstance(Dto, { quantity: '1.250' }));
    expect(ok).toHaveLength(0);
    const [error] = validateSync(plainToInstance(Dto, { quantity: 1.25 }));
    expect(Object.keys(error.constraints ?? {})).toEqual(['isDecimalString']);
    expect(Object.values(error.constraints ?? {})[0]).toContain('quantity');
  });
});

describe('IsUzPhone', () => {
  class RegisterDto {
    @IsString()
    @MaxLength(32)
    @IsUzPhone()
    phone: string;
  }

  class LoginDto {
    @IsString()
    @MaxLength(32)
    @IsUzPhone({ allowDemo: true })
    phone: string;
  }

  it('normalizes valid input before validation', () => {
    const dto = plainToInstance(RegisterDto, { phone: '+998 90 123-45-67' });
    expect(validateSync(dto)).toHaveLength(0);
    expect(dto.phone).toBe('+998901234567');
  });

  it.each(['+79161234567', '12345', 'not a phone', '+998000000001'])(
    'rejects %s',
    (phone) => {
      expect(
        validateSync(plainToInstance(RegisterDto, { phone })),
      ).not.toHaveLength(0);
    },
  );

  it('rejects non-string values', () => {
    expect(
      validateSync(plainToInstance(RegisterDto, { phone: 998901234567 })),
    ).not.toHaveLength(0);
  });

  it('allows demo numbers only when asked to', () => {
    expect(
      validateSync(plainToInstance(LoginDto, { phone: '+998000000001' })),
    ).toHaveLength(0);
  });
});

describe('SanitizedText', () => {
  class NameDto {
    @SanitizedText()
    @IsString()
    @MaxLength(5)
    name: string;
  }

  it('sanitizes before the length check', () => {
    const dto = plainToInstance(NameDto, { name: '  Ali\u0000  ' });
    expect(dto.name).toBe('Ali');
    expect(validateSync(dto)).toHaveLength(0);
    expect(
      validateSync(plainToInstance(NameDto, { name: 'abcdef' })),
    ).not.toHaveLength(0);
  });

  it('leaves non-strings for the type validators', () => {
    expect(
      validateSync(plainToInstance(NameDto, { name: 5 })),
    ).not.toHaveLength(0);
  });
});
