import { isPastDateOnly, MIN_BIRTH_DATE } from './is-past-date-only.js';

describe('isPastDateOnly', () => {
  // 2026-03-10 20:30Z is already 2026-03-11 01:30 in Tashkent (UTC+5).
  const now = new Date('2026-03-10T20:30:00Z');

  it.each(['2026-03-11', '2026-03-10', '2020-02-29', MIN_BIRTH_DATE])(
    'accepts %s',
    (value) => {
      expect(isPastDateOnly(value, now)).toBe(true);
    },
  );

  it.each([
    '2026-03-12', // tomorrow in Tashkent
    '2099-01-01',
    '1949-12-31',
    '2021-02-29', // not a leap year
    '2026-13-01',
    '2026-3-1',
    '2026-03-10T00:00:00Z',
    ' 2026-03-10',
    '',
    20260310,
    null,
    undefined,
    {},
  ])('rejects %o', (value) => {
    expect(isPastDateOnly(value, now)).toBe(false);
  });
});
