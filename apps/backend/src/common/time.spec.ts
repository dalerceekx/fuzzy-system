import {
  addDays,
  dateOnlyToDate,
  isValidDateOnly,
  secondsUntilNextTashkentDay,
  toDateOnly,
  todayInTashkent,
} from './time.js';

describe('date helpers (Asia/Tashkent business day)', () => {
  it('todayInTashkent switches at 19:00 UTC (UTC+5)', () => {
    expect(todayInTashkent(new Date('2026-10-16T18:59:59.999Z'))).toBe(
      '2026-10-16',
    );
    expect(todayInTashkent(new Date('2026-10-16T19:00:00.000Z'))).toBe(
      '2026-10-17',
    );
    expect(todayInTashkent(new Date('2026-12-31T20:00:00.000Z'))).toBe(
      '2027-01-01',
    );
  });

  it('addDays does calendar arithmetic across months, years and leap days', () => {
    expect(addDays('2026-10-16', 1)).toBe('2026-10-17');
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-16', 0)).toBe('2026-10-16');
    expect(() => addDays('2026-10-16', 1.5)).toThrow(RangeError);
  });

  it('dateOnlyToDate / toDateOnly round-trip at 00:00Z', () => {
    const date = dateOnlyToDate('2026-10-16');
    expect(date.toISOString()).toBe('2026-10-16T00:00:00.000Z');
    expect(toDateOnly(date)).toBe('2026-10-16');
  });

  it.each([
    '2026-02-30',
    '2026-13-01',
    '2026-1-01',
    '16.10.2026',
    '2026-10-16T00:00:00Z',
    '',
  ])('rejects invalid date-only value %s', (value) => {
    expect(isValidDateOnly(value)).toBe(false);
    expect(() => dateOnlyToDate(value)).toThrow(RangeError);
  });

  it('secondsUntilNextTashkentDay counts to Tashkent midnight', () => {
    expect(
      secondsUntilNextTashkentDay(new Date('2026-10-16T18:00:00.000Z')),
    ).toBe(3600);
    expect(
      secondsUntilNextTashkentDay(new Date('2026-10-16T19:00:00.000Z')),
    ).toBe(86_400);
    expect(
      secondsUntilNextTashkentDay(new Date('2026-10-16T18:59:59.900Z')),
    ).toBe(1);
  });
});
