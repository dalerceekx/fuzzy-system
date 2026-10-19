import { describe, expect, it } from 'vitest';
import type { LedgerMovement } from '../model/inventory.queries';
import { expiryStatus } from './expiry';
import { inRange, monthsInRange, purchasesByMonth, purchasesOf, sumAmounts } from './ledger';

function movement(partial: Partial<LedgerMovement>): LedgerMovement {
  return {
    id: crypto.randomUUID(),
    itemId: 'item',
    farmId: 'farm',
    type: 'IN',
    quantity: '1.000',
    balanceAfter: '1.000',
    unitCost: null,
    currency: null,
    reason: null,
    actorId: 'user',
    rationIssueId: null,
    createdAt: '2026-10-01T06:00:00.000Z',
    item: { id: 'item', name: 'Arpa', category: 'FEED', unit: 'KG' },
    ...partial,
  };
}

describe('ledger maths', () => {
  const movements = [
    movement({ quantity: '2000.000', unitCost: '3200.00', createdAt: '2026-08-22T03:00:00.000Z' }),
    movement({ type: 'OUT', quantity: '450.000', createdAt: '2026-09-06T03:00:00.000Z' }),
    movement({ quantity: '500.000', unitCost: '3400.00', createdAt: '2026-10-10T03:00:00.000Z' }),
    movement({ quantity: '10.000', unitCost: null, createdAt: '2026-10-11T03:00:00.000Z' }),
    movement({
      quantity: '100.000',
      unitCost: '1500.00',
      createdAt: '2026-10-12T03:00:00.000Z',
      item: { id: 'syringe', name: 'Shprits', category: 'EQUIPMENT', unit: 'PIECE' },
    }),
  ];

  it('values only priced intakes', () => {
    const purchases = purchasesOf(movements);
    expect(purchases).toHaveLength(3);
    expect(sumAmounts(purchases).toString()).toBe(String(2000 * 3200 + 500 * 3400 + 100 * 1500));
  });

  it('buckets purchases by Tashkent month and category', () => {
    const months = monthsInRange({ from: '2026-08-01', to: '2026-10-16' });
    expect(months).toEqual(['2026-08', '2026-09', '2026-10']);
    const byMonth = purchasesByMonth(purchasesOf(movements), months);
    expect(byMonth.get('2026-08')?.get('FEED')?.toString()).toBe('6400000');
    expect(byMonth.get('2026-09')?.size).toBe(0);
    expect(byMonth.get('2026-10')?.get('FEED')?.toString()).toBe('1700000');
    expect(byMonth.get('2026-10')?.get('EQUIPMENT')?.toString()).toBe('150000');
  });

  it('uses the Tashkent calendar day for range checks', () => {
    // 19:30 UTC on Oct 31 is already Nov 1 in Tashkent (UTC+5).
    const lateNight = movement({ createdAt: '2026-10-31T19:30:00.000Z' });
    expect(inRange(lateNight, { from: '2026-11-01', to: '2026-11-30' })).toBe(true);
    expect(inRange(lateNight, { from: '2026-10-01', to: '2026-10-31' })).toBe(false);
  });
});

describe('expiryStatus', () => {
  const today = '2026-10-16';
  it('classifies label expiry dates', () => {
    expect(expiryStatus({ expiresOn: null, openedAt: null, useWithinDaysAfterOpening: null }, today)).toBe('NONE');
    expect(expiryStatus({ expiresOn: '2026-10-15', openedAt: null, useWithinDaysAfterOpening: null }, today)).toBe('EXPIRED');
    expect(expiryStatus({ expiresOn: '2026-11-05', openedAt: null, useWithinDaysAfterOpening: null }, today)).toBe('SOON');
    expect(expiryStatus({ expiresOn: '2027-06-01', openedAt: null, useWithinDaysAfterOpening: null }, today)).toBe('OK');
  });

  it('applies the after-opening limit when it comes first', () => {
    const opened = { expiresOn: '2027-06-01', openedAt: '2026-09-01T05:00:00.000Z', useWithinDaysAfterOpening: 28 };
    expect(expiryStatus(opened, today)).toBe('EXPIRED');
  });
});
