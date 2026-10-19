import { isAxiosError } from 'axios';
import type { ApiErrorBody } from '@/shared/types/api';

/** Uzbek fallbacks for well-known backend error codes. */
const CODE_MESSAGES: Record<string, string> = {
  INVALID_CREDENTIALS: 'Telefon yoki parol noto‘g‘ri',
  ACCOUNT_LOCKED: 'Juda ko‘p urinish. Keyinroq qayta urinib ko‘ring',
  ACCOUNT_BLOCKED: 'Akkaunt bloklangan. Administrator bilan bog‘laning',
  PHONE_NOT_VERIFIED: 'Telefon raqami tasdiqlanmagan',
  MFA_INVALID: 'Tasdiqlash kodi noto‘g‘ri',
  MFA_REQUIRED: 'Ikki bosqichli tasdiqlash talab qilinadi',
  OTP_INVALID: 'Kod noto‘g‘ri yoki muddati o‘tgan',
  CSRF_FAILED: 'Sessiyani yangilab bo‘lmadi. Qaytadan kiring',
  RATE_LIMITED: 'Juda ko‘p so‘rov. Biroz kutib, qayta urinib ko‘ring',
  INSUFFICIENT_STOCK: 'Omborda yetarli miqdor yo‘q',
  TAG_NUMBER_TAKEN: 'Bu raqamli hayvon fermada allaqachon bor',
  IDEMPOTENCY_KEY_REUSED: 'So‘rov takrorlandi. Sahifani yangilab, qayta urinib ko‘ring',
  SELF_ACTION_FORBIDDEN: 'Bu amalni o‘zingizga nisbatan bajarib bo‘lmaydi',
  LAST_SUPER_ADMIN: 'Oxirgi faol super adminni o‘zgartirib bo‘lmaydi',
  MEDICINE_IMMUTABLE: 'Tasdiqlangan dorini o‘zgartirib bo‘lmaydi',
  VALIDATION_FAILED: 'Kiritilgan ma’lumotlarni tekshiring',
  FORBIDDEN: 'Bu amal uchun ruxsatingiz yo‘q',
  UNAUTHORIZED: 'Sessiya tugagan. Qaytadan kiring',
  NOT_FOUND: 'Ma’lumot topilmadi',
  CONFLICT: 'Ma’lumotlar ziddiyati. Sahifani yangilang',
  RETRY: 'So‘rov parallel amal bilan to‘qnashdi, qayta urinib ko‘ring',
  INTERNAL_ERROR: 'Serverda xatolik yuz berdi. Keyinroq urinib ko‘ring',
};

export const NETWORK_ERROR_MESSAGE = 'Server bilan aloqa yo‘q. Internet aloqasini tekshirib, qayta urinib ko‘ring';
const UNKNOWN_ERROR_MESSAGE = 'Kutilmagan xatolik yuz berdi';

/**
 * Normalized API failure. Everything the UI shows about an error goes
 * through this class — raw Axios errors never reach components.
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  /** Validation messages (backend sends a string[] for VALIDATION_FAILED). */
  readonly messages: readonly string[];
  readonly requestId: string | undefined;
  readonly details: Record<string, unknown> | undefined;
  readonly retryAfterSeconds: number | undefined;

  constructor(init: {
    status: number;
    code: string;
    message: string;
    messages?: readonly string[];
    requestId?: string | undefined;
    details?: Record<string, unknown> | undefined;
    retryAfterSeconds?: number | undefined;
  }) {
    super(init.message);
    this.name = 'ApiError';
    this.status = init.status;
    this.code = init.code;
    this.messages = init.messages ?? [];
    this.requestId = init.requestId;
    this.details = init.details;
    this.retryAfterSeconds = init.retryAfterSeconds;
  }

  get isNetworkError(): boolean {
    return this.status === 0;
  }

  get isServerError(): boolean {
    return this.status >= 500;
  }
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const body = value as Partial<ApiErrorBody>;
  return typeof body.code === 'string' && (typeof body.message === 'string' || Array.isArray(body.message));
}

function parseRetryAfter(header: unknown, details: Record<string, unknown> | undefined): number | undefined {
  const fromDetails = details?.retryAfterSeconds;
  if (typeof fromDetails === 'number' && fromDetails > 0) return fromDetails;
  const seconds = typeof header === 'string' ? Number.parseInt(header, 10) : Number.NaN;
  return Number.isFinite(seconds) && seconds > 0 ? seconds : undefined;
}

/** Converts anything thrown by the HTTP layer into an ApiError. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  if (isAxiosError(error)) {
    const response = error.response;
    if (!response) {
      return new ApiError({ status: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE });
    }
    const body: unknown = response.data;
    const headers = response.headers as Record<string, unknown>;
    if (isErrorBody(body)) {
      const messages = Array.isArray(body.message) ? body.message : [body.message];
      const knownMessage = CODE_MESSAGES[body.code];
      // Validation details are developer-oriented; show a plain Uzbek summary.
      const message =
        Array.isArray(body.message) || body.code === 'VALIDATION_FAILED'
          ? (knownMessage ?? UNKNOWN_ERROR_MESSAGE)
          : body.message || knownMessage || UNKNOWN_ERROR_MESSAGE;
      return new ApiError({
        status: response.status,
        code: body.code,
        message,
        messages,
        requestId: body.requestId,
        details: body.details,
        retryAfterSeconds: parseRetryAfter(headers['retry-after'], body.details),
      });
    }
    const code = response.status >= 500 ? 'INTERNAL_ERROR' : `HTTP_${response.status}`;
    return new ApiError({
      status: response.status,
      code,
      message: CODE_MESSAGES[code] ?? UNKNOWN_ERROR_MESSAGE,
      retryAfterSeconds: parseRetryAfter(headers['retry-after'], undefined),
    });
  }
  return new ApiError({ status: -1, code: 'CLIENT_ERROR', message: UNKNOWN_ERROR_MESSAGE });
}

/** User-facing message for any error (with a wait hint for rate limits). */
export function errorMessage(error: unknown): string {
  const apiError = toApiError(error);
  if (apiError.status === 429 && apiError.retryAfterSeconds) {
    return `${apiError.message} (${apiError.retryAfterSeconds} soniyadan keyin)`;
  }
  return apiError.message;
}

/**
 * Maps class-validator messages ("weightKg must be …") to form fields. The
 * backend message starts with the DTO property name.
 */
export function validationFieldErrors<TField extends string>(
  error: unknown,
  fields: readonly TField[],
): Partial<Record<TField, string>> {
  const apiError = toApiError(error);
  if (apiError.code !== 'VALIDATION_FAILED') return {};
  const result: Partial<Record<TField, string>> = {};
  for (const message of apiError.messages) {
    const field = fields.find((name) => message === name || message.startsWith(`${name} `));
    if (field && !result[field]) result[field] = 'Qiymat noto‘g‘ri yoki talablarga mos emas';
  }
  return result;
}
