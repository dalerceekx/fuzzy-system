import { toDateOnly } from '../common/time.js';
import type { Prisma } from '../generated/prisma/client.js';

export const ANIMAL_SELECT = {
  id: true,
  farmId: true,
  tagNumber: true,
  name: true,
  species: true,
  sex: true,
  birthDate: true,
  weightKg: true,
  notes: true,
  archivedAt: true,
  archivedReason: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.AnimalSelect;

type AnimalRow = Prisma.AnimalGetPayload<{ select: typeof ANIMAL_SELECT }>;

export type AnimalView = Omit<AnimalRow, 'birthDate' | 'weightKg'> & {
  /** 'YYYY-MM-DD' */
  birthDate: string | null;
  /** Decimal string with 2 decimals, e.g. "452.50" (never a JS number). */
  weightKg: string | null;
};

export interface ActiveWithdrawal {
  /** Last day ('YYYY-MM-DD') meat must not be used, or null if not active. */
  meatUntil: string | null;
  milkUntil: string | null;
}

export type AnimalDetailView = AnimalView & {
  activeWithdrawal: ActiveWithdrawal | null;
};

export function toAnimalView(row: AnimalRow): AnimalView {
  return {
    ...row,
    birthDate: row.birthDate ? toDateOnly(row.birthDate) : null,
    weightKg: row.weightKg ? row.weightKg.toFixed(2) : null,
  };
}

/**
 * Latest meat/milk withdrawal end dates that are still running on `today`
 * (inclusive). `null` when neither is active.
 */
export function activeWithdrawalFrom(
  treatments: ReadonlyArray<{
    withdrawalMeatUntil: Date;
    withdrawalMilkUntil: Date;
  }>,
  today: string,
): ActiveWithdrawal | null {
  let meatUntil: string | null = null;
  let milkUntil: string | null = null;
  for (const treatment of treatments) {
    const meat = toDateOnly(treatment.withdrawalMeatUntil);
    const milk = toDateOnly(treatment.withdrawalMilkUntil);
    if (meat >= today && (meatUntil === null || meat > meatUntil)) {
      meatUntil = meat;
    }
    if (milk >= today && (milkUntil === null || milk > milkUntil)) {
      milkUntil = milk;
    }
  }
  return meatUntil === null && milkUntil === null
    ? null
    : { meatUntil, milkUntil };
}
