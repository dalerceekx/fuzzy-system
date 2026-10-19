import { Prisma } from '../generated/prisma/client.js';
import { decimalString, QUANTITY_SCALE } from '../inventory/stock-balance.js';

type DecimalInput = Prisma.Decimal | string;

/**
 * Feed needed for `days` feeding days: dailyPerAnimal × animalCount × days,
 * Decimal arithmetic only. Exact: at most 9 + 7 + 4 significant digits
 * (Decimal(9, 3) × 1 000 000 × 3650), within Decimal's 20-digit precision.
 */
export function requiredQuantity(
  dailyPerAnimal: DecimalInput,
  animalCount: number,
  days: number,
): Prisma.Decimal {
  return new Prisma.Decimal(dailyPerAnimal).times(animalCount).times(days);
}

export interface IssueLineInput {
  inventoryItemId: string;
  name: string;
  dailyPerAnimal: DecimalInput;
  /** Stock read under the item's row lock. */
  available: DecimalInput;
}

export interface IssueLine {
  inventoryItemId: string;
  /** 3 fraction digits, > 0. */
  required: string;
}

export interface IssueShortage {
  inventoryItemId: string;
  name: string;
  required: string;
  available: string;
}

export interface IssuePlan {
  lines: IssueLine[];
  /** Only the items whose stock is short, in input order. */
  shortages: IssueShortage[];
}

/** Reason written on every OUT movement of an issue. */
export function issueReason(rationName: string, days: number): string {
  return `Ratsion: ${rationName} — ${days} kun`;
}

/** What an issue takes from each item, and which items cannot supply it. */
export function planIssue(
  inputs: readonly IssueLineInput[],
  animalCount: number,
  days: number,
): IssuePlan {
  const lines: IssueLine[] = [];
  const shortages: IssueShortage[] = [];
  for (const input of inputs) {
    const required = requiredQuantity(input.dailyPerAnimal, animalCount, days);
    const requiredText = decimalString(required, QUANTITY_SCALE);
    lines.push({
      inventoryItemId: input.inventoryItemId,
      required: requiredText,
    });
    if (required.gt(input.available)) {
      shortages.push({
        inventoryItemId: input.inventoryItemId,
        name: input.name,
        required: requiredText,
        available: decimalString(input.available, QUANTITY_SCALE),
      });
    }
  }
  return { lines, shortages };
}
