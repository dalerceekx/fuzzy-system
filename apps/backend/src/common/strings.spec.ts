import { sanitizeText, truncate, truncateOptional } from './strings.js';

describe('sanitizeText', () => {
  it('trims and NFC-normalizes', () => {
    expect(sanitizeText('  Ali  ')).toBe('Ali');
    expect(sanitizeText('Õ')).toBe('Õ');
  });

  it('strips C0/C1 control characters but keeps newline and tab', () => {
    expect(sanitizeText('a\u0000b\u0007c\u001bd\u007fe\u0085f\u009fg')).toBe(
      'abcdefg',
    );
    expect(sanitizeText('line1\nline2\tx\r')).toBe('line1\nline2\tx');
  });

  it('keeps Uzbek apostrophes and Cyrillic', () => {
    expect(sanitizeText('O‘zbekiston Ma’lumot Тошкент')).toBe(
      'O‘zbekiston Ma’lumot Тошкент',
    );
  });
});

describe('truncate', () => {
  it('cuts to the limit without splitting surrogate pairs', () => {
    expect(truncate('abcdef', 3)).toBe('abc');
    expect(truncate('ab', 3)).toBe('ab');
    expect(truncate('a😀b', 2)).toBe('a');
    expect(truncateOptional(undefined, 3)).toBeUndefined();
    expect(truncateOptional('', 3)).toBeUndefined();
    expect(truncateOptional('abcdef', 3)).toBe('abc');
  });
});
