import { describe, expect, it } from 'vitest';
import { Decimal } from '@/shared/lib/decimal';
import { calculateRation, issueAmount } from './ration-math';

const d = (value: string) => Decimal.from(value);

describe('calculateRation', () => {
  // 10 bulls for 30 days: 8 kg barley (3 400 so‘m, 1 250 kg in stock) + 5 kg hay (1 500 so‘m, 3 400 kg).
  const result = calculateRation({
    animalCount: d('10'),
    days: d('30'),
    lines: [
      { dailyPerAnimal: d('8'), unit: 'KG', stock: d('1250'), unitPrice: d('3400') },
      { dailyPerAnimal: d('5'), unit: 'KG', stock: d('3400'), unitPrice: d('1500') },
    ],
  });

  it('multiplies per-animal amounts by animals and days', () => {
    expect(result.lines.map((line) => [line.daily.toString(), line.period.toString()])).toEqual([
      ['80', '2400'],
      ['50', '1500'],
    ]);
    expect(result.dailyByUnit).toEqual([{ unit: 'KG', total: d('130') }]);
    expect(result.periodByUnit).toEqual([{ unit: 'KG', total: d('3900') }]);
  });

  it('prices every feed and sums the costs', () => {
    expect(result.lines.map((line) => line.dailyCost?.toString())).toEqual(['272000', '75000']);
    expect(result.dailyCost.toString()).toBe('347000');
    expect(result.periodCost.toString()).toBe('10410000');
    expect(result.unpricedLines).toBe(0);
  });

  it('checks the warehouse per feed: shortage, remaining balance and days covered', () => {
    const [barley, hay] = result.lines;
    expect(barley).toMatchObject({ sufficient: false });
    expect(barley?.shortage.toString()).toBe('1150');
    expect(barley?.remaining.toString()).toBe('0');
    expect(barley?.daysCovered?.toString()).toBe('15');
    expect(hay).toMatchObject({ sufficient: true });
    expect(hay?.remaining.toString()).toBe('1900');
    expect(result.sufficient).toBe(false);
  });

  it('leaves unpriced feeds out of the costs instead of guessing', () => {
    const partial = calculateRation({
      animalCount: d('2'),
      days: d('7'),
      lines: [
        { dailyPerAnimal: d('1.25'), unit: 'KG', stock: d('100'), unitPrice: null },
        { dailyPerAnimal: d('0.5'), unit: 'KG', stock: d('100'), unitPrice: d('2000.50') },
      ],
    });
    expect(partial.unpricedLines).toBe(1);
    expect(partial.dailyCost.toString()).toBe('2000.5');
    expect(partial.periodCost.toString()).toBe('14003.5');
    expect(partial.sufficient).toBe(true);
  });

  it('keeps decimal precision exact (no floating point)', () => {
    const exact = calculateRation({
      animalCount: d('3'),
      days: d('10'),
      lines: [{ dailyPerAnimal: d('0.1'), unit: 'KG', stock: d('3'), unitPrice: d('0.1') }],
    });
    expect(exact.lines[0]?.period.toString()).toBe('3');
    expect(exact.lines[0]?.sufficient).toBe(true);
    expect(exact.periodCost.toString()).toBe('0.3');
  });
});

describe('issueAmount', () => {
  it('is per-animal × animals × days', () => {
    expect(issueAmount(d('8.125'), d('10'), d('3')).toString()).toBe('243.75');
  });
});
