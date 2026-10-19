import { Errors, type ErrorDetails } from '../common/errors/app.exception.js';
import { isCheckViolation } from '../prisma/db-errors.js';

export const InventoryErrors = {
  /** `details` lists the short items when several are moved at once. */
  insufficientStock: (details?: ErrorDetails) =>
    Errors.conflict(
      'INSUFFICIENT_STOCK',
      'Omborda yetarli qoldiq yo‘q',
      details,
    ),
  stockLimitExceeded: () =>
    Errors.conflict(
      'STOCK_LIMIT_EXCEEDED',
      'Qoldiq ruxsat etilgan maksimal qiymatdan oshib ketadi',
    ),
  archived: () =>
    Errors.conflict('INVENTORY_ITEM_ARCHIVED', 'Mahsulot arxivlangan'),
  alreadyOpened: () =>
    Errors.conflict('ALREADY_OPENED', 'Mahsulot allaqachon ochilgan'),
  shelfLifeLocked: () =>
    Errors.conflict(
      'MEDICINE_SHELF_LIFE_LOCKED',
      'Dori yaroqlilik muddatini uzaytirish yoki o‘chirish mumkin emas',
    ),
  medicineNotApproved: () =>
    Errors.unprocessable(
      'MEDICINE_NOT_APPROVED',
      'Dori topilmadi yoki tasdiqlanmagan',
    ),
  medicineCategoryRequired: () =>
    Errors.badRequest(
      'MEDICINE_CATEGORY_REQUIRED',
      'Dori faqat MEDICINE toifasidagi mahsulotga bog‘lanadi',
    ),
};

// Non-negative stock constraints (migration 20261016000100). The service
// refuses such movements first; these are the database backstop under any
// path the service check might miss.
const STOCK_CHECKS = [
  'inventory_items_quantity_non_negative_chk',
  'stock_movements_balance_non_negative_chk',
];

export function isNegativeStockViolation(err: unknown): boolean {
  return STOCK_CHECKS.some((constraint) => isCheckViolation(err, constraint));
}
