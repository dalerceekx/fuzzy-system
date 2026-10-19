import { Prisma } from '../generated/prisma/client.js';
import {
  issueReason,
  planIssue,
  requiredQuantity,
} from './ration-quantities.js';

const line = (
  inventoryItemId: string,
  dailyPerAnimal: string,
  available: string,
) => ({
  inventoryItemId,
  name: `Yem ${inventoryItemId}`,
  dailyPerAnimal,
  available,
});

describe('requiredQuantity', () => {
  it('is dailyPerAnimal × animalCount × days, exactly', () => {
    expect(requiredQuantity('8', 10, 30).toFixed(3)).toBe('2400.000');
    expect(requiredQuantity('0.001', 1, 1).toFixed(3)).toBe('0.001');
    // 0.1 × 3 is 0.30000000000000004 in floating point.
    expect(requiredQuantity('0.1', 3, 1).toFixed(3)).toBe('0.300');
    expect(requiredQuantity('2.345', 7, 13).toFixed(3)).toBe('213.395');
    expect(requiredQuantity(new Prisma.Decimal('1.5'), 2, 2).toFixed(3)).toBe(
      '6.000',
    );
  });

  it('stays exact at the largest inputs the DTOs allow', () => {
    // 19 significant digits: beyond IEEE-754 doubles, within Decimal's 20.
    expect(requiredQuantity('999999.999', 999_999, 3649).toFixed(3)).toBe(
      '3648996347351003.649',
    );
    expect(requiredQuantity('999999.999', 1_000_000, 3650).toFixed(3)).toBe(
      '3649999996350000.000',
    );
    const exact = (999_999_999n * 999_999n * 3649n).toString();
    expect(
      requiredQuantity('999999.999', 999_999, 3649).toFixed(3).replace('.', ''),
    ).toBe(exact);
  });
});

describe('planIssue', () => {
  it('computes every line with 3 decimals and no shortage when stock suffices', () => {
    const plan = planIssue(
      [line('a', '8', '2400'), line('b', '0.5', '1000.000')],
      10,
      30,
    );
    expect(plan).toEqual({
      lines: [
        { inventoryItemId: 'a', required: '2400.000' },
        { inventoryItemId: 'b', required: '150.000' },
      ],
      shortages: [],
    });
  });

  it('lists only the short items, with required and available amounts', () => {
    const plan = planIssue(
      [
        line('a', '8', '2399.999'),
        // Exactly enough is enough.
        line('b', '1', '300'),
        line('c', '0.001', '0'),
      ],
      10,
      30,
    );
    expect(plan.shortages).toEqual([
      {
        inventoryItemId: 'a',
        name: 'Yem a',
        required: '2400.000',
        available: '2399.999',
      },
      {
        inventoryItemId: 'c',
        name: 'Yem c',
        required: '0.300',
        available: '0.000',
      },
    ]);
    expect(plan.lines).toHaveLength(3);
  });

  it('flags amounts larger than any stock level can be', () => {
    const plan = planIssue(
      [line('a', '999999.999', '99999999999.999')],
      1_000_000,
      3650,
    );
    expect(plan.shortages).toEqual([
      expect.objectContaining({ required: '3649999996350000.000' }),
    ]);
  });
});

describe('issueReason', () => {
  it('names the ration and the number of days', () => {
    expect(issueReason('Semirtirish 1-bosqich', 7)).toBe(
      'Ratsion: Semirtirish 1-bosqich — 7 kun',
    );
  });
});
