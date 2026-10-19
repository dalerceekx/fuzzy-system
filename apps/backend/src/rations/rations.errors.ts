import { Errors } from '../common/errors/app.exception.js';
import type { RationParameterViolation } from './ration-profiles.js';

export const RationErrors = {
  animalTypeExists: () =>
    Errors.conflict(
      'RATION_ANIMAL_TYPE_EXISTS',
      'Bu fermada shu nomli hayvon kategoriyasi allaqachon mavjud',
    ),
  animalTypeDefault: () =>
    Errors.conflict(
      'RATION_ANIMAL_TYPE_DEFAULT',
      'Standart hayvon kategoriyasini o‘chirib bo‘lmaydi',
    ),
  animalTypeInUse: (rations: number) =>
    Errors.conflict(
      'RATION_ANIMAL_TYPE_IN_USE',
      'Bu kategoriyada faol ratsionlar bor — avval ularni o‘chiring',
      { rations },
    ),
  animalTypeArchived: () =>
    Errors.conflict(
      'RATION_ANIMAL_TYPE_ARCHIVED',
      'Hayvon kategoriyasi allaqachon o‘chirilgan',
    ),
  animalTypeInvalid: () =>
    Errors.unprocessable(
      'RATION_ANIMAL_TYPE_INVALID',
      'Hayvon kategoriyasi topilmadi yoki o‘chirilgan',
    ),
  parameterInvalid: (field: RationParameterViolation) =>
    Errors.unprocessable(
      'RATION_PARAMETER_INVALID',
      'Ratsion parametri tanlangan hayvon kategoriyasiga mos emas',
      { field },
    ),
  itemDuplicate: (inventoryItemId: string) =>
    Errors.badRequest(
      'RATION_ITEM_DUPLICATE',
      'Bitta yem ratsionda bir necha marta ko‘rsatilgan',
      { inventoryItemId },
    ),
  itemInvalid: (inventoryItemId: string) =>
    Errors.unprocessable(
      'RATION_ITEM_INVALID',
      'Yem topilmadi, o‘chirilgan yoki “Yem” toifasida emas',
      { inventoryItemId },
    ),
  itemArchived: (inventoryItemId: string) =>
    Errors.conflict(
      'RATION_ITEM_ARCHIVED',
      'Ratsiondagi yem ombordan o‘chirilgan',
      { inventoryItemId },
    ),
  archived: () => Errors.conflict('RATION_ARCHIVED', 'Ratsion o‘chirilgan'),
};
