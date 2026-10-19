import { z } from 'zod';
import { Decimal } from '@/shared/lib/decimal';
import { todayInTashkent, isValidIsoDate } from '@/shared/lib/dates';
import { optionalDecimalString, optionalText, requiredText } from '@/shared/lib/validation';
import { ANIMAL_SEXES, SPECIES, type Animal, type CreateAnimalInput, type UpdateAnimalInput } from '../api/animals.api';

/** Mirrors the backend DTO limits (CONTRACT §7.1). */
export const animalFormSchema = z.object({
  species: z.enum(SPECIES, { message: 'Hayvon turini tanlang' }),
  sex: z.enum(ANIMAL_SEXES),
  tagNumber: requiredText('Birka raqamini kiriting', 50),
  name: optionalText(100),
  birthDate: z
    .string()
    .trim()
    .refine((value) => value === '' || isValidIsoDate(value), 'Sana noto‘g‘ri')
    .refine((value) => value === '' || value <= todayInTashkent(), 'Tug‘ilgan sana kelajakda bo‘lishi mumkin emas'),
  weightKg: optionalDecimalString({ maxIntegerDigits: 4, maxFractionDigits: 2, positive: true, max: '5000' }),
  notes: optionalText(1000),
});

export type AnimalFormInput = z.input<typeof animalFormSchema>;
export type AnimalFormValues = z.output<typeof animalFormSchema>;

export const ANIMAL_FORM_FIELDS = ['species', 'sex', 'tagNumber', 'name', 'birthDate', 'weightKg', 'notes'] as const;

export function emptyAnimalForm(): AnimalFormInput {
  return { species: 'CATTLE', sex: 'FEMALE', tagNumber: '', name: '', birthDate: '', weightKg: '', notes: '' };
}

export function animalToForm(animal: Animal): AnimalFormInput {
  return {
    species: animal.species,
    sex: animal.sex,
    tagNumber: animal.tagNumber,
    name: animal.name ?? '',
    birthDate: animal.birthDate ?? '',
    weightKg: animal.weightKg ?? '',
    notes: animal.notes ?? '',
  };
}

/** Only fields with a value are sent: the API rejects null and unknown fields. */
export function toCreateInput(farmId: string, values: AnimalFormValues): CreateAnimalInput {
  return {
    farmId,
    species: values.species,
    sex: values.sex,
    tagNumber: values.tagNumber,
    ...(values.name ? { name: values.name } : {}),
    ...(values.birthDate ? { birthDate: values.birthDate } : {}),
    ...(values.weightKg ? { weightKg: values.weightKg } : {}),
    ...(values.notes ? { notes: values.notes } : {}),
  };
}

/** PATCH body with changed fields only (farmId is immutable and never sent). */
export function toUpdateInput(original: Animal, values: AnimalFormValues): UpdateAnimalInput {
  const next = toCreateInput(original.farmId, values);
  const { farmId: _farmId, ...rest } = next;
  const before = animalToForm(original);
  const changed: UpdateAnimalInput = {};
  for (const [key, value] of Object.entries(rest) as Array<[keyof UpdateAnimalInput, string]>) {
    const unchanged =
      key === 'weightKg' ? Decimal.parse(before.weightKg)?.compare(Decimal.from(value)) === 0 : before[key] === value;
    if (!unchanged) Object.assign(changed, { [key]: value });
  }
  return changed;
}

/**
 * Optional fields cannot be cleared through the API (null is rejected), so
 * emptying a previously filled field is reported instead of silently ignored.
 */
export function clearedFields(original: Animal, values: AnimalFormValues): Array<'name' | 'birthDate' | 'weightKg' | 'notes'> {
  const fields = ['name', 'birthDate', 'weightKg', 'notes'] as const;
  return fields.filter((field) => original[field] !== null && !values[field]);
}
