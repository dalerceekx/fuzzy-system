import { HttpException, HttpStatus } from '@nestjs/common';

export type ErrorDetails = Record<string, unknown>;

/** Default user-facing messages (Uzbek, Latin). */
export const ErrorMessages = {
  notFound: 'Topilmadi',
  forbidden: 'Ruxsat yo‘q',
  unauthorized: 'Avtorizatsiya talab qilinadi',
  tooManyRequests: 'Juda ko‘p so‘rov. Keyinroq qayta urinib ko‘ring',
  internal: 'Ichki server xatosi',
  badRequest: 'Noto‘g‘ri so‘rov',
  invalidJson: 'JSON formati noto‘g‘ri',
  payloadTooLarge: 'So‘rov hajmi juda katta',
  unsupportedMediaType: 'Qo‘llab-quvvatlanmaydigan format',
  methodNotAllowed: 'Bu amal qo‘llab-quvvatlanmaydi',
  unprocessable: 'So‘rovni bajarib bo‘lmaydi',
  conflict: 'Ma’lumotlar ziddiyati',
  duplicate: 'Bunday ma’lumot allaqachon mavjud',
  constraint: 'Ma’lumotlar cheklovlarga mos emas',
  retry: 'So‘rov parallel amal bilan to‘qnashdi, qayta urinib ko‘ring',
  invalidId: 'Identifikator noto‘g‘ri',
  httpsRequired: 'Faqat HTTPS orqali ruxsat etiladi',
  unknownField: 'Ruxsat etilmagan maydon yuborildi',
} as const;

/**
 * The only exception type application code should throw for expected
 * failures. The global filter renders it as
 * `{ statusCode, code, message, requestId, details? }`.
 */
export class AppException extends HttpException {
  readonly code: string;
  readonly details?: ErrorDetails;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: ErrorDetails,
  ) {
    super(
      { statusCode: status, code, message, ...(details ? { details } : {}) },
      status,
    );
    this.code = code;
    this.details = details;
  }
}

export const Errors = {
  notFound(message: string = ErrorMessages.notFound): AppException {
    return new AppException(HttpStatus.NOT_FOUND, 'NOT_FOUND', message);
  },

  forbidden(
    message: string = ErrorMessages.forbidden,
    code = 'FORBIDDEN',
  ): AppException {
    return new AppException(HttpStatus.FORBIDDEN, code, message);
  },

  unauthorized(
    message: string = ErrorMessages.unauthorized,
    code = 'UNAUTHORIZED',
  ): AppException {
    return new AppException(HttpStatus.UNAUTHORIZED, code, message);
  },

  conflict(
    code: string,
    message: string,
    details?: ErrorDetails,
  ): AppException {
    return new AppException(HttpStatus.CONFLICT, code, message, details);
  },

  badRequest(
    code: string,
    message: string,
    details?: ErrorDetails,
  ): AppException {
    return new AppException(HttpStatus.BAD_REQUEST, code, message, details);
  },

  unprocessable(
    code: string,
    message: string,
    details?: ErrorDetails,
  ): AppException {
    return new AppException(
      HttpStatus.UNPROCESSABLE_ENTITY,
      code,
      message,
      details,
    );
  },

  /** 503: the server is missing data it needs (e.g. reference not loaded). */
  serviceUnavailable(code: string, message: string): AppException {
    return new AppException(HttpStatus.SERVICE_UNAVAILABLE, code, message);
  },

  /** 429; the filter turns `details.retryAfterSeconds` into `Retry-After`. */
  tooManyRequests(
    retryAfterSeconds: number,
    message: string = ErrorMessages.tooManyRequests,
    code = 'RATE_LIMITED',
  ): AppException {
    const seconds = Math.max(1, Math.ceil(retryAfterSeconds));
    return new AppException(HttpStatus.TOO_MANY_REQUESTS, code, message, {
      retryAfterSeconds: seconds,
    });
  },
};
