import { describe, expect, it } from 'vitest';
import { addDays, dailyStatus } from './daily';

const issue = (createdAt: string, days: number) => ({ lastIssue: { id: 'i1', createdAt, days } });

describe('dailyStatus', () => {
  it('is not given when the ration was never issued', () => {
    expect(dailyStatus({ lastIssue: null }, '2026-10-19')).toEqual({ given: false, coveredUntil: null, issuedAt: null });
  });

  it('counts a 1-day issue for its own Tashkent date only', () => {
    // 20:30 UTC on the 18th is already the 19th in Tashkent (UTC+5).
    const status = dailyStatus(issue('2026-10-18T20:30:00.000Z', 1), '2026-10-19');
    expect(status).toMatchObject({ given: true, coveredUntil: '2026-10-19' });
    expect(dailyStatus(issue('2026-10-18T20:30:00.000Z', 1), '2026-10-20').given).toBe(false);
  });

  it('covers every day of a multi-day issue', () => {
    expect(dailyStatus(issue('2026-10-15T06:00:00.000Z', 7), '2026-10-21')).toMatchObject({
      given: true,
      coveredUntil: '2026-10-21',
    });
    expect(dailyStatus(issue('2026-10-15T06:00:00.000Z', 7), '2026-10-22').given).toBe(false);
  });
});

describe('addDays', () => {
  it('crosses month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});
