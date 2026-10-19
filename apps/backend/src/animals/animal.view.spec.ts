import { Prisma } from '../generated/prisma/client.js';
import { activeWithdrawalFrom, toAnimalView } from './animal.view.js';

const d = (value: string) => new Date(`${value}T00:00:00Z`);

describe('activeWithdrawalFrom', () => {
  const today = '2026-10-16';

  it('returns null without treatments or when every period has ended', () => {
    expect(activeWithdrawalFrom([], today)).toBeNull();
    expect(
      activeWithdrawalFrom(
        [
          {
            withdrawalMeatUntil: d('2026-10-15'),
            withdrawalMilkUntil: d('2026-01-01'),
          },
        ],
        today,
      ),
    ).toBeNull();
  });

  it('treats today as still active and takes the latest date per product', () => {
    expect(
      activeWithdrawalFrom(
        [
          {
            withdrawalMeatUntil: d('2026-10-16'),
            withdrawalMilkUntil: d('2026-10-10'),
          },
          {
            withdrawalMeatUntil: d('2026-11-01'),
            withdrawalMilkUntil: d('2026-10-20'),
          },
          {
            withdrawalMeatUntil: d('2026-10-20'),
            withdrawalMilkUntil: d('2026-10-18'),
          },
        ],
        today,
      ),
    ).toEqual({ meatUntil: '2026-11-01', milkUntil: '2026-10-20' });
  });

  it('reports only the product whose withdrawal is still running', () => {
    expect(
      activeWithdrawalFrom(
        [
          {
            withdrawalMeatUntil: d('2026-10-01'),
            withdrawalMilkUntil: d('2026-10-17'),
          },
        ],
        today,
      ),
    ).toEqual({ meatUntil: null, milkUntil: '2026-10-17' });
  });
});

describe('toAnimalView', () => {
  it('serializes dates as YYYY-MM-DD and weights as 2-decimal strings', () => {
    const now = new Date();
    const view = toAnimalView({
      id: 'a',
      farmId: 'f',
      tagNumber: 'T-1',
      name: null,
      species: 'CATTLE',
      sex: 'FEMALE',
      birthDate: d('2024-02-29'),
      weightKg: new Prisma.Decimal('450.5'),
      notes: null,
      archivedAt: null,
      archivedReason: null,
      createdAt: now,
      updatedAt: now,
    });
    expect(view.birthDate).toBe('2024-02-29');
    expect(view.weightKg).toBe('450.50');
  });
});
