import {
  computeTreatmentPlan,
  laterDate,
  openedUseByDate,
  singleDose,
} from './dosing.js';

describe('singleDose', () => {
  it('multiplies with Decimal precision', () => {
    // 0.1 × 3 is 0.30000000000000004 in floating point.
    expect(singleDose('0.1', '3', null).toFixed(4)).toBe('0.3000');
    expect(singleDose('0.2000', '452.35', null).toFixed(4)).toBe('90.4700');
  });

  it('caps at maxSingleDose', () => {
    expect(singleDose('0.5', '450', '100').toFixed(4)).toBe('100.0000');
    expect(singleDose('0.5', '100', '100').toFixed(4)).toBe('50.0000');
  });

  it('rounds half-up to 4 decimal places', () => {
    expect(singleDose('0.0001', '0.55', null).toFixed(4)).toBe('0.0001');
    expect(singleDose('0.0001', '0.45', null).toFixed(4)).toBe('0.0000');
    expect(singleDose('1.2345', '1.01', null).toFixed(4)).toBe('1.2468');
  });
});

describe('computeTreatmentPlan', () => {
  const drug = {
    medicineId: 'a',
    dosePerKg: '0.2',
    maxSingleDose: null,
    durationDays: 3,
    withdrawalMeatDays: 7,
    withdrawalMilkDays: 3,
  };

  it('counts the start day as day 1', () => {
    const plan = computeTreatmentPlan('450', '2026-10-10', [drug]);
    expect(plan).toMatchObject({
      startsOn: '2026-10-10',
      endsOn: '2026-10-12',
      withdrawalMeatUntil: '2026-10-19',
      withdrawalMilkUntil: '2026-10-15',
    });
    expect(plan.drugs[0].singleDose.toFixed(4)).toBe('90.0000');
  });

  it('takes the latest end and withdrawal dates over all drugs', () => {
    const plan = computeTreatmentPlan('100', '2026-12-30', [
      { ...drug, medicineId: 'a', durationDays: 5, withdrawalMeatDays: 0 },
      {
        ...drug,
        medicineId: 'b',
        durationDays: 1,
        withdrawalMeatDays: 28,
        withdrawalMilkDays: 0,
      },
    ]);
    expect(plan.endsOn).toBe('2027-01-03');
    // b: last day 12-30 + 28 days; a: last day 01-03 + 3 days (milk).
    expect(plan.withdrawalMeatUntil).toBe('2027-01-27');
    expect(plan.withdrawalMilkUntil).toBe('2027-01-06');
    expect(plan.drugs.map((d) => d.lastDay)).toEqual([
      '2027-01-03',
      '2026-12-30',
    ]);
  });

  it('a one-day course with no withdrawal ends and clears on the start day', () => {
    const plan = computeTreatmentPlan('10', '2028-02-28', [
      {
        ...drug,
        durationDays: 1,
        withdrawalMeatDays: 0,
        withdrawalMilkDays: 0,
      },
    ]);
    expect(plan).toMatchObject({
      endsOn: '2028-02-28',
      withdrawalMeatUntil: '2028-02-28',
      withdrawalMilkUntil: '2028-02-28',
    });
  });

  it('refuses an empty drug list', () => {
    expect(() => computeTreatmentPlan('10', '2026-10-10', [])).toThrow();
  });
});

describe('openedUseByDate', () => {
  it('uses the Tashkent calendar day of opening', () => {
    // 20:00Z on Oct 1 is already Oct 2 in Tashkent (UTC+5).
    expect(openedUseByDate(new Date('2026-10-01T20:00:00Z'), 28)).toBe(
      '2026-10-30',
    );
    expect(openedUseByDate(new Date('2026-10-01T18:59:59Z'), 28)).toBe(
      '2026-10-29',
    );
  });
});

describe('laterDate', () => {
  it('compares calendar dates', () => {
    expect(laterDate('2026-10-09', '2026-10-10')).toBe('2026-10-10');
    expect(laterDate('2027-01-01', '2026-12-31')).toBe('2027-01-01');
  });
});
