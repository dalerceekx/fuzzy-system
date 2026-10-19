import { Errors } from '../common/errors/app.exception.js';

export const EMERGENCY_ADVICE =
  'Shoshilinch holat: darhol veterinar shifokorga murojaat qiling. Avtomatik dori tavsiya qilinmaydi.';

export const VetErrors = {
  emptyUpdate: () =>
    Errors.badRequest('EMPTY_UPDATE', 'O‘zgartirish uchun maydon yuborilmadi'),
  duplicateMedicine: () =>
    Errors.badRequest(
      'DUPLICATE_MEDICINE',
      'Bir dori bir necha marta ko‘rsatilgan',
    ),
  drugsRequired: () =>
    Errors.badRequest(
      'DRUGS_REQUIRED',
      'Shoshilinch bo‘lmagan protokolda kamida bitta dori bo‘lishi kerak',
    ),
  demoNotApprovable: () =>
    Errors.conflict(
      'DEMO_NOT_APPROVABLE',
      'Demo klinik ma’lumotlarni tasdiqlab bo‘lmaydi',
    ),

  medicineImmutable: () =>
    Errors.conflict(
      'MEDICINE_IMMUTABLE',
      'Tasdiqlangan yoki arxivlangan dorini o‘zgartirib bo‘lmaydi',
    ),
  medicineNotDraft: () =>
    Errors.conflict(
      'MEDICINE_NOT_DRAFT',
      'Faqat qoralama holatidagi dorini tasdiqlash mumkin',
    ),
  medicineArchived: () =>
    Errors.conflict('MEDICINE_ARCHIVED', 'Dori allaqachon arxivlangan'),
  medicineUnavailable: (medicineIds: string[]) =>
    Errors.unprocessable(
      'MEDICINE_UNAVAILABLE',
      'Dori topilmadi yoki arxivlangan',
      { medicineIds },
    ),
  medicineNotApproved: (medicineIds: string[]) =>
    Errors.unprocessable(
      'MEDICINE_NOT_APPROVED',
      'Protokoldagi dori tasdiqlanmagan',
      { medicineIds },
    ),

  protocolCodeTaken: () =>
    Errors.conflict(
      'PROTOCOL_CODE_TAKEN',
      'Bu kodli protokol allaqachon mavjud',
    ),
  protocolArchived: () =>
    Errors.conflict('PROTOCOL_ARCHIVED', 'Protokol arxivlangan'),
  protocolImmutable: () =>
    Errors.conflict(
      'PROTOCOL_IMMUTABLE',
      'Tasdiqlangan protokolni o‘zgartirib bo‘lmaydi — yangi versiya yarating',
    ),
  versionNotDraft: () =>
    Errors.conflict(
      'PROTOCOL_VERSION_NOT_DRAFT',
      'Faqat qoralama versiyani tasdiqlash mumkin',
    ),
  versionArchived: () =>
    Errors.conflict(
      'PROTOCOL_VERSION_ARCHIVED',
      'Protokol versiyasi allaqachon arxivlangan',
    ),
  draftExists: () =>
    Errors.conflict(
      'PROTOCOL_DRAFT_EXISTS',
      'Bu protokolning qoralama versiyasi allaqachon mavjud',
    ),

  protocolNotApproved: () =>
    Errors.unprocessable(
      'PROTOCOL_NOT_APPROVED',
      'Protokol topilmadi yoki tasdiqlanmagan',
    ),
  emergencyRequiresVet: () =>
    Errors.unprocessable(
      'EMERGENCY_REQUIRES_VET',
      'Shoshilinch holat: davolashni faqat veterinar shifokor belgilaydi',
    ),
  speciesMismatch: () =>
    Errors.unprocessable(
      'SPECIES_MISMATCH',
      'Protokol bu hayvon turi uchun mo‘ljallanmagan',
    ),
  weightRequired: () =>
    Errors.unprocessable('WEIGHT_REQUIRED', 'Hayvon vazni ko‘rsatilmagan'),
  doseTooSmall: () =>
    Errors.unprocessable('DOSE_TOO_SMALL', 'Hisoblangan doza juda kichik'),
  medicineNotInProtocol: () =>
    Errors.unprocessable('MEDICINE_NOT_IN_PROTOCOL', 'Dori bu protokolda yo‘q'),
  inventoryItemMismatch: () =>
    Errors.unprocessable(
      'INVENTORY_ITEM_MISMATCH',
      'Ombordagi mahsulot bu dori emas',
    ),
  inventoryItemArchived: () =>
    Errors.unprocessable(
      'INVENTORY_ITEM_ARCHIVED',
      'Ombordagi mahsulot arxivlangan',
    ),
  medicineExpiryUnknown: () =>
    Errors.unprocessable(
      'MEDICINE_EXPIRY_UNKNOWN',
      'Dorining yaroqlilik muddati kiritilmagan',
    ),
  medicineExpired: () =>
    Errors.unprocessable(
      'MEDICINE_EXPIRED',
      'Dorining yaroqlilik muddati davolash tugashidan oldin o‘tadi',
    ),
  medicineOpenedExpiryUnknown: () =>
    Errors.unprocessable(
      'MEDICINE_OPENED_EXPIRY_UNKNOWN',
      'Ochilgan dorining ochilgandan keyingi ishlatish muddati kiritilmagan',
    ),
  inventoryItemEmpty: () =>
    Errors.unprocessable('INVENTORY_ITEM_EMPTY', 'Ombordagi mahsulot qolmagan'),
  medicineOpenedExpired: () =>
    Errors.unprocessable(
      'MEDICINE_OPENED_EXPIRED',
      'Ochilgan dorining ishlatish muddati davolash tugashidan oldin o‘tadi',
    ),
  treatmentNotActive: () =>
    Errors.conflict('TREATMENT_NOT_ACTIVE', 'Davolash faol emas'),
};
