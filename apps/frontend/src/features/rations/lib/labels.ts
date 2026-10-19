import type { Animal } from '@/features/animals/api/animals.api';
import type { AnimalType, FeedingPurpose, PhysiologicalState, ProfileField, RationProfile } from '../api/rations.api';

export const PURPOSE_LABELS: Record<FeedingPurpose, string> = {
  FATTENING: 'Semirtirish',
  MAINTENANCE: 'Saqlash',
  MILK: 'Sut berish',
  BREEDING: 'Ko‘paytirish davri',
};

export const STATE_LABELS: Record<PhysiologicalState, string> = {
  NORMAL: 'Oddiy holat',
  PREGNANT: 'Bo‘g‘oz',
  LACTATING: 'Emizadi / sog‘iladi',
  DRY: 'Quruq davr (sog‘ilmaydi)',
};

/** What each animal category's ration asks for (spec 4.3). */
export const PROFILE_HINTS: Record<RationProfile, string> = {
  BULL: 'Vazn, yosh va semirtirish maqsadi',
  COW: 'Vazn, sut berish holati va mahsuldorligi',
  RAM: 'Vazn, yosh, saqlash yoki ko‘paytirish davri',
  EWE: 'Vazn, yosh, bo‘g‘ozlik va emizish holati',
  OTHER: 'Vazn, yosh, maqsad va holat',
};

export const PROFILE_LABELS: Record<RationProfile, string> = {
  BULL: 'Buqa kabi',
  COW: 'Sigir kabi',
  RAM: 'Qo‘chqor kabi',
  EWE: 'Qo‘y kabi',
  OTHER: 'Umumiy',
};

export const FIELD_LABELS: Record<ProfileField, string> = {
  averageWeightKg: 'O‘rtacha vazni (kg)',
  ageMonths: 'Yoshi (oy)',
  milkYieldLiters: 'Sut mahsuldorligi (l/kun, bir boshga)',
};

/** Herd animals of this category: same species, and the same sex when the category has one. */
export function belongsToType(
  animal: Pick<Animal, 'species' | 'sex' | 'archivedAt'>,
  type: Pick<AnimalType, 'species' | 'sex'>,
): boolean {
  return !animal.archivedAt && animal.species === type.species && (type.sex === null || animal.sex === type.sex);
}
