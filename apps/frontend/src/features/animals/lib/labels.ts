import { monthsBetween, todayInTashkent } from '@/shared/lib/dates';
import type { AnimalSex, Species } from '../api/animals.api';

export const SPECIES_LABELS: Record<Species, string> = {
  CATTLE: 'Qoramol',
  SHEEP: 'Qo‘y',
  GOAT: 'Echki',
  HORSE: 'Ot',
  POULTRY: 'Parranda',
  OTHER: 'Boshqa',
};

export const SEX_LABELS: Record<AnimalSex, string> = {
  FEMALE: 'Urg‘ochi',
  MALE: 'Erkak',
  UNKNOWN: 'Noma’lum',
};

/** Everyday names farmers use (sigir, buqa, qo‘chqor…). */
const KIND_NAMES: Partial<Record<Species, Partial<Record<AnimalSex, string>>>> = {
  CATTLE: { FEMALE: 'Sigir', MALE: 'Buqa' },
  SHEEP: { FEMALE: 'Sovliq', MALE: 'Qo‘chqor' },
  GOAT: { FEMALE: 'Echki', MALE: 'Taka' },
  HORSE: { FEMALE: 'Biya', MALE: 'Ayg‘ir' },
  POULTRY: { FEMALE: 'Tovuq', MALE: 'Xo‘roz' },
};

export function animalKind(species: Species, sex: AnimalSex): string {
  return KIND_NAMES[species]?.[sex] ?? SPECIES_LABELS[species];
}

/** "Qoramol · Sigir", or just "Qo‘y" when there is no more specific name. */
export function speciesWithKind(species: Species, sex: AnimalSex): { species: string; kind: string | null } {
  const kind = animalKind(species, sex);
  return { species: SPECIES_LABELS[species], kind: kind === SPECIES_LABELS[species] ? null : kind };
}

/**
 * Generic age buckets computed from the birth date. They are a display aid
 * only — not species-specific husbandry or feeding categories.
 */
export const AGE_CATEGORIES = ['UNDER_1', 'ONE_TO_TWO', 'OVER_2', 'UNKNOWN'] as const;
export type AgeCategory = (typeof AGE_CATEGORIES)[number];

export const AGE_CATEGORY_LABELS: Record<AgeCategory, string> = {
  UNDER_1: '1 yoshgacha',
  ONE_TO_TWO: '1–2 yosh',
  OVER_2: '2 yoshdan katta',
  UNKNOWN: 'Yoshi noma’lum',
};

export function ageCategory(birthDate: string | null, today = todayInTashkent()): AgeCategory {
  const months = birthDate ? monthsBetween(birthDate, today) : null;
  if (months === null || months < 0) return 'UNKNOWN';
  if (months < 12) return 'UNDER_1';
  if (months < 24) return 'ONE_TO_TWO';
  return 'OVER_2';
}

/** "3 yosh 2 oy", "5 oy", "1 oydan kam". */
export function ageLabel(birthDate: string | null, today = todayInTashkent()): string {
  const months = birthDate ? monthsBetween(birthDate, today) : null;
  if (months === null || months < 0) return '—';
  if (months === 0) return '1 oydan kam';
  const years = Math.floor(months / 12);
  const rest = months % 12;
  if (years === 0) return `${rest} oy`;
  return rest === 0 ? `${years} yosh` : `${years} yosh ${rest} oy`;
}

export const ARCHIVE_REASONS = ['Sotildi', 'So‘yildi', 'Nobud bo‘ldi', 'Boshqa fermaga o‘tkazildi', 'Boshqa sabab'] as const;
