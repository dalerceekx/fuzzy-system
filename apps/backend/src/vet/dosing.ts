import { addDays, todayInTashkent } from '../common/time.js';
import { Prisma } from '../generated/prisma/client.js';

/** Scale of protocol_drugs.dose_per_kg / treatment_doses.single_dose. */
export const DOSE_SCALE = 4;
/** Scale of animals.weight_kg / treatments.animal_weight_kg. */
export const WEIGHT_SCALE = 2;

type DecimalInput = Prisma.Decimal | string;

export interface DrugPlanInput {
  medicineId: string;
  dosePerKg: DecimalInput;
  maxSingleDose: DecimalInput | null;
  durationDays: number;
  withdrawalMeatDays: number;
  withdrawalMilkDays: number;
}

export interface DrugPlan {
  medicineId: string;
  singleDose: Prisma.Decimal;
  /** Last treatment day of this drug ('YYYY-MM-DD', Tashkent calendar). */
  lastDay: string;
  withdrawalMeatUntil: string;
  withdrawalMilkUntil: string;
}

export interface TreatmentPlan {
  startsOn: string;
  endsOn: string;
  withdrawalMeatUntil: string;
  withdrawalMilkUntil: string;
  drugs: DrugPlan[];
}

/**
 * min(dosePerKg × weight, maxSingleDose), rounded half-up to 4 decimal
 * places. Decimal arithmetic only: clinical doses never pass through
 * floating point.
 */
export function singleDose(
  dosePerKg: DecimalInput,
  weightKg: DecimalInput,
  maxSingleDose: DecimalInput | null,
): Prisma.Decimal {
  let dose = new Prisma.Decimal(dosePerKg).times(weightKg);
  if (maxSingleDose !== null && dose.gt(maxSingleDose)) {
    dose = new Prisma.Decimal(maxSingleDose);
  }
  return dose.toDecimalPlaces(DOSE_SCALE, Prisma.Decimal.ROUND_HALF_UP);
}

/** Later of two 'YYYY-MM-DD' dates (lexicographic order = date order). */
export function laterDate(a: string, b: string): string {
  return a >= b ? a : b;
}

/**
 * Doses, end date and withdrawal dates of a treatment starting on
 * `startsOn` (a Tashkent calendar date). Day 1 is the start day, so a
 * 3-day course starting on the 10th ends on the 12th; each drug's
 * withdrawal period starts after its own last day, and the treatment's
 * withdrawal date is the latest over all drugs.
 */
export function computeTreatmentPlan(
  weightKg: DecimalInput,
  startsOn: string,
  drugs: readonly DrugPlanInput[],
): TreatmentPlan {
  if (drugs.length === 0) throw new RangeError('a plan needs at least 1 drug');
  let endsOn = startsOn;
  let meatUntil = startsOn;
  let milkUntil = startsOn;
  const planned = drugs.map((drug): DrugPlan => {
    const lastDay = addDays(startsOn, drug.durationDays - 1);
    const plan: DrugPlan = {
      medicineId: drug.medicineId,
      singleDose: singleDose(drug.dosePerKg, weightKg, drug.maxSingleDose),
      lastDay,
      withdrawalMeatUntil: addDays(lastDay, drug.withdrawalMeatDays),
      withdrawalMilkUntil: addDays(lastDay, drug.withdrawalMilkDays),
    };
    endsOn = laterDate(endsOn, lastDay);
    meatUntil = laterDate(meatUntil, plan.withdrawalMeatUntil);
    milkUntil = laterDate(milkUntil, plan.withdrawalMilkUntil);
    return plan;
  });
  return {
    startsOn,
    endsOn,
    withdrawalMeatUntil: meatUntil,
    withdrawalMilkUntil: milkUntil,
    drugs: planned,
  };
}

/**
 * Last day an opened item may be used: the Tashkent calendar day it was
 * opened plus its after-opening shelf life.
 */
export function openedUseByDate(openedAt: Date, useWithinDays: number): string {
  return addDays(todayInTashkent(openedAt), useWithinDays);
}

/** Fixed-scale decimal string for API responses and snapshots. */
export function decimalString(value: DecimalInput, scale: number): string {
  return new Prisma.Decimal(value).toFixed(scale);
}
