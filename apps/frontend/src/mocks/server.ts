/**
 * Contract-faithful mock of the Mening Fermam API (CONTRACT §4–§7) for
 * tests and the explicit development "namuna rejimi". It reproduces the
 * behaviours the UI depends on: auth + MFA + refresh rotation with CSRF,
 * role checks, owner scoping (404 for foreign rows), whitelisted query/body
 * fields (400), pagination, INSUFFICIENT_STOCK and Idempotency-Key replay.
 */
import { Decimal } from '@/shared/lib/decimal';
import type { Paginated, PublicUser, UserRole } from '@/shared/types/api';
import type { Animal } from '@/features/animals/api/animals.api';
import type { AuditLog } from '@/features/audit/api/audit.api';
import type { InventoryItem, StockMovement } from '@/features/inventory/api/inventory.api';
import type { Medicine } from '@/features/medicines/api/medicines.api';
import type { AnimalType, ProfileConfig, Ration } from '@/features/rations/api/rations.api';
import { diseaseCatalog, normalizeSearch } from './diseases';
import {
  createSeedDb,
  MOCK_MFA_CODE,
  type MockDb,
  type MockRation,
  type MockRationIssue,
  type MockSession,
  type MockUser,
} from './db';

/** Runtime rows get random UUIDs (the seed uses stable ids); safe across reloads of a persisted mock DB. */
function newId(): string {
  return crypto.randomUUID();
}

export interface MockRequest {
  method: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}

export interface MockResponse {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

class MockHttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string | string[],
    readonly details?: Record<string, unknown>,
  ) {
    super(Array.isArray(message) ? message.join('; ') : message);
    this.body = { statusCode: status, code, message, requestId: 'mock-request', ...(details ? { details } : {}) };
  }
  readonly body: unknown;
}

function fail(status: number, code: string, message: string | string[], details?: Record<string, unknown>): never {
  throw new MockHttpError(status, code, message, details);
}

// Function declarations (not arrow consts) so TypeScript narrows after them.
function notFound(): never {
  return fail(404, 'NOT_FOUND', 'Topilmadi');
}
function forbidden(): never {
  return fail(403, 'FORBIDDEN', 'Ruxsat yo‘q');
}
function unauthorized(): never {
  return fail(401, 'UNAUTHORIZED', 'Avtorizatsiya talab qilinadi');
}
function invalid(messages: string[]): never {
  return fail(400, 'VALIDATION_FAILED', messages);
}

interface Ctx {
  req: MockRequest;
  params: Record<string, string>;
  db: MockDb;
  user: MockUser;
  session: MockSession;
}

type Access = 'public' | readonly UserRole[];
type Handler = (ctx: Ctx) => MockResponse;
type PublicHandler = (ctx: Omit<Ctx, 'user' | 'session'>) => MockResponse;

interface Route {
  method: string;
  pattern: RegExp;
  keys: string[];
  access: Access;
  handler: Handler | PublicHandler;
}

const ALL: readonly UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'VET', 'FARMER'];
const FARMER: readonly UserRole[] = ['FARMER'];
const STAFF_READ: readonly UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'SUPPORT'];
const ADMINS: readonly UserRole[] = ['SUPER_ADMIN', 'ADMIN'];
const MED_MANAGERS: readonly UserRole[] = ['VET', 'ADMIN', 'SUPER_ADMIN'];

const ok = (body?: unknown, status = 200): MockResponse => ({ status, body });
const now = () => new Date().toISOString();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Validation helpers (the real API whitelists DTO fields: unknown → 400)
// ---------------------------------------------------------------------------

function readBody(ctx: { req: MockRequest }, allowed: readonly string[]): Record<string, unknown> {
  const value = ctx.req.body ?? {};
  if (typeof value !== 'object' || Array.isArray(value)) invalid(['body must be an object']);
  const record = value as Record<string, unknown>;
  const unknown = Object.keys(record).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) invalid(unknown.map((key) => `property ${key} should not exist`));
  return record;
}

function query(ctx: { req: MockRequest }, allowed: readonly string[]): Record<string, string> {
  const unknown = Object.keys(ctx.req.query).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) invalid(unknown.map((key) => `property ${key} should not exist`));
  return ctx.req.query;
}

function str(record: Record<string, unknown>, key: string, { required = false, max = 1000 } = {}): string | undefined {
  const value = record[key];
  if (value === undefined) {
    if (required) invalid([`${key} should not be empty`]);
    return undefined;
  }
  if (typeof value !== 'string') invalid([`${key} must be a string`]);
  const trimmed = value.trim();
  if (required && trimmed.length === 0) invalid([`${key} should not be empty`]);
  if (trimmed.length > max) invalid([`${key} must be shorter than or equal to ${max} characters`]);
  return trimmed;
}

function oneOf<T extends string>(
  record: Record<string, unknown>,
  key: string,
  values: readonly T[],
  required = false,
): T | undefined {
  const value = record[key];
  if (value === undefined) {
    if (required) invalid([`${key} should not be empty`]);
    return undefined;
  }
  if (typeof value !== 'string' || !values.includes(value as T))
    invalid([`${key} must be one of the following values: ${values.join(', ')}`]);
  return value as T;
}

function decimalField(
  record: Record<string, unknown>,
  key: string,
  fractionDigits: number,
  required = false,
): Decimal | undefined {
  const value = record[key];
  if (value === undefined) {
    if (required) invalid([`${key} should not be empty`]);
    return undefined;
  }
  // The API accepts decimals as JSON strings only.
  if (typeof value !== 'string') invalid([`${key} must be a decimal string`]);
  const parsed = /^\d+(\.\d+)?$/.test(value) ? Decimal.parse(value) : null;
  if (!parsed || parsed.significantScale() > fractionDigits) invalid([`${key} must be a decimal string`]);
  return parsed;
}

function dateField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid([`${key} must be a valid ISO 8601 date string`]);
  return value;
}

function paginate<T>(items: T[], q: Record<string, string>): Paginated<T> {
  const page = q.page === undefined ? 1 : Number(q.page);
  const limit = q.limit === undefined ? 20 : Number(q.limit);
  if (!Number.isInteger(page) || page < 1) invalid(['page must not be less than 1']);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalid(['limit must not be greater than 100']);
  return { items: items.slice((page - 1) * limit, page * limit), page, limit, total: items.length };
}

function sortBy<T>(
  items: T[],
  sort: string | undefined,
  allowed: Record<string, (item: T) => string | number | null>,
  fallback: string,
): T[] {
  const value = sort ?? fallback;
  const direction = value.startsWith('-') ? -1 : 1;
  const field = value.replace(/^-/, '');
  const getter = allowed[field];
  if (!getter) invalid([`sort must be one of the following values: ${Object.keys(allowed).join(', ')}`]);
  return [...items].sort((a, b) => {
    const left = getter(a) ?? '';
    const right = getter(b) ?? '';
    return left < right ? -direction : left > right ? direction : 0;
  });
}

function boolParam(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  if (value !== 'true' && value !== 'false') invalid(['boolean param must be true or false']);
  return value === 'true';
}

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

const MFA_ROLES: readonly UserRole[] = ['SUPER_ADMIN', 'ADMIN'];

function publicUser(user: MockUser): PublicUser {
  const { password: _password, ...rest } = user;
  return rest;
}

function token(prefix: string, db: MockDb): string {
  db.sequence += 1;
  return `${prefix}.${db.sequence}.${Math.random().toString(36).slice(2)}`;
}

function audit(
  db: MockDb,
  actor: MockUser | null,
  action: string,
  resourceType: string,
  resourceId: string | null,
  oldValue?: unknown,
  newValue?: unknown,
) {
  const entry: AuditLog = {
    id: newId(),
    actorId: actor?.id ?? null,
    actorRole: actor?.role ?? null,
    action,
    resourceType,
    resourceId,
    oldValue: oldValue ?? null,
    newValue: newValue ?? null,
    ip: '127.0.0.1',
    userAgent: 'Mock',
    requestId: `mock-${db.sequence}`,
    timestamp: now(),
  };
  db.auditLogs.unshift(entry);
}

function createSession(db: MockDb, user: MockUser, req: MockRequest): MockResponse {
  const session: MockSession = {
    id: newId(),
    userId: user.id,
    accessToken: token('access', db),
    refreshToken: token('refresh', db),
    mfaVerified: MFA_ROLES.includes(user.role),
    createdAt: now(),
    lastUsedAt: now(),
    userAgent: req.headers['user-agent'] ?? null,
    revoked: false,
  };
  db.sessions.push(session);
  db.refreshCookie = session.id;
  db.csrfToken = token('csrf', db);
  user.lastLoginAt = now();
  audit(db, user, 'auth.login.success', 'session', session.id);
  return ok({ status: 'AUTHENTICATED', accessToken: session.accessToken, accessTokenExpiresIn: 900, user: publicUser(user) });
}

function authenticate(db: MockDb, req: MockRequest): { user: MockUser; session: MockSession } {
  const match = /^Bearer (.+)$/.exec(req.headers.authorization ?? '');
  if (!match) unauthorized();
  const session = db.sessions.find((candidate) => candidate.accessToken === match[1]);
  if (!session || session.revoked) unauthorized();
  const user = db.users.find((candidate) => candidate.id === session.userId);
  if (!user || user.status !== 'ACTIVE') unauthorized();
  if (MFA_ROLES.includes(user.role) && !session.mfaVerified) unauthorized();
  session.lastUsedAt = now();
  return { user, session };
}

function consumeMfaToken(db: MockDb, value: unknown, purpose: 'challenge' | 'setup') {
  const entry = db.mfaTokens.find((candidate) => candidate.token === value && candidate.purpose === purpose && !candidate.used);
  if (!entry) unauthorized();
  return entry;
}

// ---------------------------------------------------------------------------
// Domain helpers
// ---------------------------------------------------------------------------

function ownedFarm(ctx: Ctx, farmId: unknown) {
  const farm = ctx.db.farms.find((candidate) => candidate.id === farmId && candidate.ownerId === ctx.user.id);
  if (!farm) notFound();
  return farm;
}

function ownedFarmIds(ctx: Ctx): Set<string> {
  return new Set(ctx.db.farms.filter((farm) => farm.ownerId === ctx.user.id).map((farm) => farm.id));
}

function ownedAnimal(ctx: Ctx): Animal {
  const farms = ownedFarmIds(ctx);
  const animal = ctx.db.animals.find((candidate) => candidate.id === ctx.params.id && farms.has(candidate.farmId));
  if (!animal) notFound();
  return animal;
}

function ownedItem(ctx: Ctx): InventoryItem {
  const farms = ownedFarmIds(ctx);
  const item = ctx.db.items.find((candidate) => candidate.id === ctx.params.id && farms.has(candidate.farmId));
  if (!item) notFound();
  return item;
}

function targetUser(ctx: Ctx, allowArchived = false): MockUser {
  const target = ctx.db.users.find((candidate) => candidate.id === ctx.params.id);
  if (!target || (!allowArchived && target.status === 'ARCHIVED')) notFound();
  // Demo isolation: a demo actor only sees demo users.
  if (ctx.user.isDemo && !target.isDemo) notFound();
  return target;
}

function assertCanActOn(ctx: Ctx, target: MockUser): void {
  if (target.id === ctx.user.id) fail(403, 'SELF_ACTION_FORBIDDEN', 'O‘zingizga nisbatan bu amalni bajarib bo‘lmaydi');
  if (ctx.user.role === 'ADMIN' && MFA_ROLES.includes(target.role)) forbidden();
}

function revokeUserSessions(db: MockDb, userId: string): void {
  for (const session of db.sessions) if (session.userId === userId) session.revoked = true;
}

const SPECIES = ['CATTLE', 'SHEEP', 'GOAT', 'HORSE', 'POULTRY', 'OTHER'] as const;
const SEXES = ['MALE', 'FEMALE', 'UNKNOWN'] as const;
const CATEGORIES = ['MEDICINE', 'FEED', 'EQUIPMENT', 'OTHER'] as const;
const UNITS = ['PIECE', 'KG', 'G', 'L', 'ML', 'DOSE'] as const;
const MOVEMENTS = ['IN', 'OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT'] as const;

function readAnimalBody(record: Record<string, unknown>, creating: boolean) {
  const weight = decimalField(record, 'weightKg', 2);
  if (weight && (weight.isZero() || weight.gt(Decimal.from(5000)))) invalid(['weightKg must be greater than 0 and at most 5000']);
  const birthDate = dateField(record, 'birthDate');
  if (birthDate && birthDate > now().slice(0, 10)) invalid(['birthDate must not be in the future']);
  return {
    tagNumber: str(record, 'tagNumber', { required: creating, max: 50 }),
    species: oneOf(record, 'species', SPECIES, creating),
    sex: oneOf(record, 'sex', SEXES),
    name: str(record, 'name', { max: 100 }),
    birthDate,
    weightKg: weight ? weight.toFixed(2) : undefined,
    notes: str(record, 'notes', { max: 1000 }),
  };
}

function withoutUndefined<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as Partial<T>;
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value as Record<string, unknown>)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

const routes: Route[] = [];

function route(method: string, path: string, access: 'public', handler: PublicHandler): void;
function route(method: string, path: string, access: readonly UserRole[], handler: Handler): void;
function route(method: string, path: string, access: Access, handler: Handler | PublicHandler): void {
  const keys: string[] = [];
  const pattern = new RegExp(
    `^${path.replace(/:(\w+)/g, (_, key: string) => {
      keys.push(key);
      return '([^/]+)';
    })}$`,
  );
  routes.push({ method, pattern, keys, access, handler });
}

// --- auth ------------------------------------------------------------------

route('POST', '/auth/login', 'public', ({ req, db }) => {
  const record = readBody({ req }, ['phone', 'password']);
  const phone = str(record, 'phone', { required: true, max: 32 });
  const password = str(record, 'password', { required: true, max: 128 });
  if (!phone || !/^\+998\d{9}$/.test(phone)) invalid(['phone must be a valid Uzbek phone number']);
  const user = db.users.find((candidate) => candidate.phone === phone);
  if (!user || user.password !== password || user.status === 'ARCHIVED') {
    fail(401, 'INVALID_CREDENTIALS', 'Telefon yoki parol noto‘g‘ri');
  }
  if (user.status === 'PENDING_VERIFICATION') fail(403, 'PHONE_NOT_VERIFIED', 'Telefon raqami tasdiqlanmagan');
  if (user.status === 'BLOCKED') fail(403, 'ACCOUNT_BLOCKED', 'Akkaunt bloklangan');
  if (MFA_ROLES.includes(user.role)) {
    const purpose = user.mfaEnabled ? 'challenge' : 'setup';
    const mfaToken = token('mfa', db);
    db.mfaTokens.push({ token: mfaToken, userId: user.id, purpose, used: false });
    return ok({ status: user.mfaEnabled ? 'MFA_REQUIRED' : 'MFA_SETUP_REQUIRED', mfaToken, mfaTokenExpiresIn: 300 });
  }
  return createSession(db, user, req);
});

route('POST', '/auth/mfa/setup', 'public', ({ req, db }) => {
  const record = readBody({ req }, ['mfaToken']);
  const entry = consumeMfaToken(db, record.mfaToken, 'setup');
  const user = db.users.find((candidate) => candidate.id === entry.userId);
  if (!user) unauthorized();
  return ok({
    secret: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
    otpauthUrl: `otpauth://totp/MeningFermam:${user.phone.slice(0, 6)}*****?secret=JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP&issuer=MeningFermam&algorithm=SHA1&digits=6&period=30`,
  });
});

route('POST', '/auth/mfa/enable', 'public', ({ req, db }) => {
  const record = readBody({ req }, ['mfaToken', 'code']);
  const entry = consumeMfaToken(db, record.mfaToken, 'setup');
  if (record.code !== MOCK_MFA_CODE) fail(401, 'MFA_INVALID', 'Kod noto‘g‘ri');
  entry.used = true;
  const user = db.users.find((candidate) => candidate.id === entry.userId);
  if (!user) unauthorized();
  user.mfaEnabled = true;
  return createSession(db, user, req);
});

route('POST', '/auth/mfa/verify', 'public', ({ req, db }) => {
  const record = readBody({ req }, ['mfaToken', 'code']);
  const entry = consumeMfaToken(db, record.mfaToken, 'challenge');
  if (record.code !== MOCK_MFA_CODE) fail(401, 'MFA_INVALID', 'Kod noto‘g‘ri');
  entry.used = true;
  const user = db.users.find((candidate) => candidate.id === entry.userId);
  if (!user) unauthorized();
  return createSession(db, user, req);
});

route('POST', '/auth/refresh', 'public', ({ req, db }) => {
  readBody({ req }, ['refreshToken']);
  if (!db.refreshCookie) unauthorized();
  if (!db.csrfToken || req.headers['x-csrf-token'] !== db.csrfToken) fail(403, 'CSRF_FAILED', 'CSRF tekshiruvi muvaffaqiyatsiz');
  const session = db.sessions.find((candidate) => candidate.id === db.refreshCookie && !candidate.revoked);
  const user = session && db.users.find((candidate) => candidate.id === session.userId && candidate.status === 'ACTIVE');
  if (!session || !user) {
    db.refreshCookie = null;
    unauthorized();
  }
  session.accessToken = token('access', db);
  session.refreshToken = token('refresh', db);
  return ok({ status: 'AUTHENTICATED', accessToken: session.accessToken, accessTokenExpiresIn: 900, user: publicUser(user) });
});

route('POST', '/auth/logout', ALL, ({ db, session, user }) => {
  session.revoked = true;
  db.refreshCookie = null;
  db.csrfToken = null;
  audit(db, user, 'auth.logout', 'session', session.id);
  return ok(undefined, 204);
});

route('POST', '/auth/logout-all', ALL, ({ db, user }) => {
  revokeUserSessions(db, user.id);
  db.refreshCookie = null;
  db.csrfToken = null;
  audit(db, user, 'auth.logout_all', 'user', user.id);
  return ok(undefined, 204);
});

route('GET', '/auth/me', ALL, ({ user }) => ok(publicUser(user)));

route('GET', '/auth/sessions', ALL, ({ db, user, session }) =>
  ok(
    db.sessions
      .filter((candidate) => candidate.userId === user.id && !candidate.revoked)
      .map((candidate) => ({
        id: candidate.id,
        createdAt: candidate.createdAt,
        lastUsedAt: candidate.lastUsedAt,
        ip: '127.0.0.1',
        userAgent: candidate.userAgent,
        current: candidate.id === session.id,
      })),
  ),
);

route('DELETE', '/auth/sessions/:id', ALL, ({ db, user, params }) => {
  const target = db.sessions.find(
    (candidate) => candidate.id === params.id && candidate.userId === user.id && !candidate.revoked,
  );
  if (!target) notFound();
  target.revoked = true;
  return ok(undefined, 204);
});

route('POST', '/auth/password/change', ALL, ({ req, db, user, session }) => {
  const record = readBody({ req }, ['currentPassword', 'newPassword']);
  if (record.currentPassword !== user.password) fail(401, 'INVALID_CREDENTIALS', 'Joriy parol noto‘g‘ri');
  const next = str(record, 'newPassword', { required: true, max: 128 }) ?? '';
  if (next.length < 8 || !/\d/.test(next) || !/\p{L}/u.test(next)) invalid(['newPassword is too weak']);
  user.password = next;
  for (const other of db.sessions) if (other.userId === user.id && other.id !== session.id) other.revoked = true;
  audit(db, user, 'auth.password.changed', 'user', user.id);
  return ok(undefined, 204);
});

function issueOtp(db: MockDb, phone: string, purpose: 'PHONE_VERIFICATION' | 'PASSWORD_RESET') {
  const verificationId = newId();
  const code = String(100000 + (db.sequence % 899999));
  db.sequence += 1;
  db.otps.push({ verificationId, phone, purpose, code, consumed: false });
  db.sms.unshift({
    to: `${phone.slice(0, 6)}*****${phone.slice(-2)}`,
    text: `RIIZQ: Tasdiqlash kodingiz: ${code}. Kod 5 daqiqa amal qiladi. Uni hech kimga bermang.`,
    sentAt: now(),
  });
  return { verificationId, expiresIn: 300, resendAfter: 60, message: 'Agar raqam to‘g‘ri bo‘lsa, tasdiqlash kodi yuboriladi' };
}

const registerHandler: PublicHandler = ({ req, db }) => {
  const record = readBody({ req }, ['phone', 'fullName', 'password']);
  const phone = str(record, 'phone', { required: true, max: 32 }) ?? '';
  const fullName = str(record, 'fullName', { required: true, max: 100 }) ?? '';
  const password = str(record, 'password', { required: true, max: 128 }) ?? '';
  const existing = db.users.find((candidate) => candidate.phone === phone);
  if (existing && existing.status !== 'PENDING_VERIFICATION') {
    return ok(
      {
        verificationId: newId(),
        expiresIn: 300,
        resendAfter: 60,
        message: 'Agar raqam to‘g‘ri bo‘lsa, tasdiqlash kodi yuboriladi',
      },
      202,
    );
  }
  if (existing) {
    existing.fullName = fullName;
    existing.password = password;
  } else {
    db.users.push({
      id: newId(),
      phone,
      email: null,
      fullName,
      role: 'FARMER',
      status: 'PENDING_VERIFICATION',
      phoneVerifiedAt: null,
      mfaEnabled: false,
      isDemo: false,
      lastLoginAt: null,
      createdAt: now(),
      updatedAt: now(),
      blockedAt: null,
      archivedAt: null,
      password,
    });
  }
  return ok(issueOtp(db, phone, 'PHONE_VERIFICATION'), 202);
};
route('POST', '/auth/register', 'public', registerHandler);
route('POST', '/auth/otp/send', 'public', registerHandler);

function consumeOtp(db: MockDb, record: Record<string, unknown>, purpose: 'PHONE_VERIFICATION' | 'PASSWORD_RESET') {
  const otp = db.otps.find(
    (candidate) => candidate.verificationId === record.verificationId && candidate.purpose === purpose && !candidate.consumed,
  );
  if (!otp || otp.code !== record.code) fail(400, 'OTP_INVALID', 'Kod noto‘g‘ri yoki muddati o‘tgan');
  otp.consumed = true;
  return otp;
}

const verifyPhoneHandler: PublicHandler = ({ req, db }) => {
  const otp = consumeOtp(db, readBody({ req }, ['verificationId', 'code']), 'PHONE_VERIFICATION');
  const user = db.users.find((candidate) => candidate.phone === otp.phone);
  if (user) {
    user.status = 'ACTIVE';
    user.phoneVerifiedAt = now();
  }
  return ok({ message: 'Telefon raqami tasdiqlandi' });
};
route('POST', '/auth/verify-phone', 'public', verifyPhoneHandler);
route('POST', '/auth/otp/verify', 'public', verifyPhoneHandler);

route('POST', '/auth/otp/resend', 'public', ({ req, db }) => {
  const record = readBody({ req }, ['verificationId']);
  const otp = db.otps.find((candidate) => candidate.verificationId === record.verificationId && !candidate.consumed);
  if (!otp)
    return ok(
      {
        verificationId: String(record.verificationId),
        expiresIn: 300,
        resendAfter: 60,
        message: 'Agar raqam to‘g‘ri bo‘lsa, tasdiqlash kodi yuboriladi',
      },
      202,
    );
  otp.consumed = true;
  return ok(issueOtp(db, otp.phone, otp.purpose), 202);
});

route('POST', '/auth/password/forgot', 'public', ({ req, db }) => {
  const phone = str(readBody({ req }, ['phone']), 'phone', { required: true, max: 32 }) ?? '';
  const user = db.users.find((candidate) => candidate.phone === phone && candidate.status === 'ACTIVE');
  if (!user)
    return ok(
      {
        verificationId: newId(),
        expiresIn: 300,
        resendAfter: 60,
        message: 'Agar raqam to‘g‘ri bo‘lsa, tasdiqlash kodi yuboriladi',
      },
      202,
    );
  return ok(issueOtp(db, phone, 'PASSWORD_RESET'), 202);
});

route('POST', '/auth/password/reset', 'public', ({ req, db }) => {
  const record = readBody({ req }, ['verificationId', 'code', 'newPassword']);
  const otp = consumeOtp(db, record, 'PASSWORD_RESET');
  const user = db.users.find((candidate) => candidate.phone === otp.phone);
  if (user) {
    user.password = String(record.newPassword);
    revokeUserSessions(db, user.id);
  }
  return ok({ message: 'Parol yangilandi' });
});

route('GET', '/dev/sms-inbox', 'public', ({ db }) => ok(db.sms.slice(0, 20)));

// --- farms -----------------------------------------------------------------

route('GET', '/farms', FARMER, (ctx) => {
  const q = query(ctx, ['page', 'limit', 'sort']);
  const own = ctx.db.farms.filter((farm) => farm.ownerId === ctx.user.id);
  const sorted = sortBy(own, q.sort, { createdAt: (farm) => farm.createdAt, name: (farm) => farm.name }, '-createdAt');
  return ok(
    paginate(
      sorted.map(({ ownerId: _ownerId, ...farm }) => farm),
      q,
    ),
  );
});

route('POST', '/farms', FARMER, (ctx) => {
  const record = readBody(ctx, ['name', 'region']);
  const farm = {
    id: newId(),
    ownerId: ctx.user.id,
    name: str(record, 'name', { required: true, max: 100 }) ?? '',
    region: str(record, 'region', { max: 100 }) ?? null,
    archivedAt: null,
    createdAt: now(),
    updatedAt: now(),
  };
  ctx.db.farms.push(farm);
  const { ownerId: _ownerId, ...result } = farm;
  return ok(result, 201);
});

route('PATCH', '/farms/:id', FARMER, (ctx) => {
  const farm = ownedFarm(ctx, ctx.params.id);
  const record = readBody(ctx, ['name', 'region']);
  Object.assign(
    farm,
    withoutUndefined({ name: str(record, 'name', { max: 100 }), region: str(record, 'region', { max: 100 }) }),
    { updatedAt: now() },
  );
  const { ownerId: _ownerId, ...result } = farm;
  return ok(result);
});

route('POST', '/farms/:id/archive', FARMER, (ctx) => {
  const farm = ownedFarm(ctx, ctx.params.id);
  const busy =
    ctx.db.animals.some((animal) => animal.farmId === farm.id && !animal.archivedAt) ||
    ctx.db.items.some((item) => item.farmId === farm.id && !item.archivedAt);
  if (busy) fail(409, 'FARM_NOT_EMPTY', 'Fermada faol hayvonlar yoki ombor mahsulotlari bor');
  farm.archivedAt = now();
  const { ownerId: _ownerId, ...result } = farm;
  return ok(result);
});

// --- animals ---------------------------------------------------------------

route('GET', '/animals', FARMER, (ctx) => {
  const q = query(ctx, ['page', 'limit', 'sort', 'farmId', 'species', 'includeArchived']);
  const farms = ownedFarmIds(ctx);
  const includeArchived = boolParam(q.includeArchived) ?? false;
  const filtered = ctx.db.animals.filter(
    (animal) =>
      farms.has(animal.farmId) &&
      (!q.farmId || animal.farmId === q.farmId) &&
      (!q.species || animal.species === q.species) &&
      (includeArchived || !animal.archivedAt),
  );
  const sorted = sortBy(
    filtered,
    q.sort,
    { createdAt: (a) => a.createdAt, tagNumber: (a) => a.tagNumber, name: (a) => a.name },
    '-createdAt',
  );
  return ok(paginate(sorted, q));
});

route('GET', '/animals/:id', FARMER, (ctx) => ok({ ...ownedAnimal(ctx), activeWithdrawal: null }));

route('POST', '/animals', FARMER, (ctx) => {
  const record = readBody(ctx, ['farmId', 'tagNumber', 'species', 'sex', 'name', 'birthDate', 'weightKg', 'notes']);
  const farm = ownedFarm(ctx, record.farmId);
  const fields = readAnimalBody(record, true);
  if (ctx.db.animals.some((animal) => animal.farmId === farm.id && !animal.archivedAt && animal.tagNumber === fields.tagNumber)) {
    fail(409, 'TAG_NUMBER_TAKEN', 'Bu raqamli hayvon fermada allaqachon bor');
  }
  const animal: Animal = {
    id: newId(),
    farmId: farm.id,
    tagNumber: fields.tagNumber ?? '',
    species: fields.species ?? 'OTHER',
    sex: fields.sex ?? 'UNKNOWN',
    name: fields.name ?? null,
    birthDate: fields.birthDate ?? null,
    weightKg: fields.weightKg ?? null,
    notes: fields.notes ?? null,
    archivedAt: null,
    archivedReason: null,
    createdAt: now(),
    updatedAt: now(),
  };
  ctx.db.animals.push(animal);
  return ok(animal, 201);
});

route('PATCH', '/animals/:id', FARMER, (ctx) => {
  const animal = ownedAnimal(ctx);
  if (animal.archivedAt) fail(409, 'ANIMAL_ARCHIVED', 'Arxivlangan hayvonni tahrirlab bo‘lmaydi');
  const fields = withoutUndefined(
    readAnimalBody(readBody(ctx, ['tagNumber', 'species', 'sex', 'name', 'birthDate', 'weightKg', 'notes']), false),
  );
  if (
    fields.tagNumber &&
    ctx.db.animals.some(
      (other) =>
        other.id !== animal.id && other.farmId === animal.farmId && !other.archivedAt && other.tagNumber === fields.tagNumber,
    )
  ) {
    fail(409, 'TAG_NUMBER_TAKEN', 'Bu raqamli hayvon fermada allaqachon bor');
  }
  Object.assign(animal, fields, { updatedAt: now() });
  return ok(animal);
});

route('POST', '/animals/:id/archive', FARMER, (ctx) => {
  const animal = ownedAnimal(ctx);
  const reason = str(readBody(ctx, ['reason']), 'reason', { required: true, max: 500 });
  if (animal.archivedAt) fail(409, 'ANIMAL_ARCHIVED', 'Hayvon allaqachon arxivlangan');
  animal.archivedAt = now();
  animal.archivedReason = reason ?? null;
  audit(
    ctx.db,
    ctx.user,
    'animal.archived',
    'animal',
    animal.id,
    { archivedAt: null },
    { archivedAt: animal.archivedAt, reason },
  );
  return ok(animal);
});

// --- inventory -------------------------------------------------------------

route('GET', '/inventory/items', FARMER, (ctx) => {
  const q = query(ctx, ['page', 'limit', 'sort', 'farmId', 'category', 'includeArchived']);
  const farms = ownedFarmIds(ctx);
  const includeArchived = boolParam(q.includeArchived) ?? false;
  const filtered = ctx.db.items.filter(
    (item) =>
      farms.has(item.farmId) &&
      (!q.farmId || item.farmId === q.farmId) &&
      (!q.category || item.category === q.category) &&
      (includeArchived || !item.archivedAt),
  );
  const sorted = sortBy(
    filtered,
    q.sort,
    { createdAt: (i) => i.createdAt, name: (i) => i.name, expiresOn: (i) => i.expiresOn },
    '-createdAt',
  );
  return ok(paginate(sorted, q));
});

route('GET', '/inventory/items/:id', FARMER, (ctx) => ok(ownedItem(ctx)));

route('POST', '/inventory/items', FARMER, (ctx) => {
  const record = readBody(ctx, [
    'farmId',
    'name',
    'category',
    'unit',
    'medicineId',
    'batchNumber',
    'expiresOn',
    'useWithinDaysAfterOpening',
    'unitPrice',
    'minQuantity',
    'initialQuantity',
  ]);
  const farm = ownedFarm(ctx, record.farmId);
  const category = oneOf(record, 'category', CATEGORIES, true) ?? 'OTHER';
  if (record.medicineId !== undefined) {
    const medicine = ctx.db.medicines.find((candidate) => candidate.id === record.medicineId && candidate.status === 'APPROVED');
    if (!medicine || category !== 'MEDICINE') fail(422, 'MEDICINE_NOT_APPROVED', 'Faqat tasdiqlangan dori bog‘lanadi');
  }
  const days = record.useWithinDaysAfterOpening;
  if (days !== undefined && (typeof days !== 'number' || !Number.isInteger(days) || days < 1))
    invalid(['useWithinDaysAfterOpening must be a positive integer']);
  const unitPrice = decimalField(record, 'unitPrice', 2);
  const minQuantity = decimalField(record, 'minQuantity', 3);
  const initialQuantity = decimalField(record, 'initialQuantity', 3);
  if (initialQuantity?.isZero()) invalid(['initialQuantity must be greater than 0']);
  const item: InventoryItem = {
    id: newId(),
    farmId: farm.id,
    name: str(record, 'name', { required: true, max: 120 }) ?? '',
    category,
    unit: oneOf(record, 'unit', UNITS, true) ?? 'PIECE',
    quantity: (initialQuantity ?? Decimal.ZERO).toFixed(3),
    medicineId: (record.medicineId as string | undefined) ?? null,
    batchNumber: str(record, 'batchNumber', { max: 64 }) ?? null,
    expiresOn: dateField(record, 'expiresOn') ?? null,
    openedAt: null,
    useWithinDaysAfterOpening: (days as number | undefined) ?? null,
    unitPrice: unitPrice ? unitPrice.toFixed(2) : null,
    minQuantity: minQuantity ? minQuantity.toFixed(3) : null,
    archivedAt: null,
    createdAt: now(),
    updatedAt: now(),
  };
  ctx.db.items.push(item);
  audit(ctx.db, ctx.user, 'inventory.item.created', 'inventory_item', item.id, null, { name: item.name });
  if (initialQuantity) {
    // The opening balance is a normal (priced) intake in the same request.
    const movement: StockMovement = {
      id: newId(),
      itemId: item.id,
      farmId: item.farmId,
      type: 'IN',
      quantity: initialQuantity.toFixed(3),
      balanceAfter: item.quantity,
      unitCost: item.unitPrice,
      currency: item.unitPrice ? 'UZS' : null,
      reason: 'Boshlang‘ich qoldiq',
      actorId: ctx.user.id,
      rationIssueId: null,
      createdAt: now(),
    };
    ctx.db.movements.push(movement);
    audit(ctx.db, ctx.user, 'inventory.stock.in', 'stock_movement', movement.id, null, { quantity: movement.quantity });
  }
  return ok(item, 201);
});

/** PATCH semantics: undefined keeps, null clears, a value replaces. */
function nullableDecimal(record: Record<string, unknown>, key: string, fractionDigits: number): string | null | undefined {
  if (record[key] === null) return null;
  return decimalField(record, key, fractionDigits)?.toFixed(fractionDigits);
}

route('PATCH', '/inventory/items/:id', FARMER, (ctx) => {
  const item = ownedItem(ctx);
  const record = readBody(ctx, ['name', 'batchNumber', 'expiresOn', 'useWithinDaysAfterOpening', 'unitPrice', 'minQuantity']);
  Object.assign(
    item,
    withoutUndefined({
      name: str(record, 'name', { max: 120 }),
      batchNumber: str(record, 'batchNumber', { max: 64 }),
      expiresOn: dateField(record, 'expiresOn'),
      unitPrice: nullableDecimal(record, 'unitPrice', 2),
      minQuantity: nullableDecimal(record, 'minQuantity', 3),
    }),
    { updatedAt: now() },
  );
  return ok(item);
});

route('POST', '/inventory/items/:id/open', FARMER, (ctx) => {
  const item = ownedItem(ctx);
  if (item.openedAt) fail(409, 'ALREADY_OPENED', 'Idish allaqachon ochilgan');
  item.openedAt = now();
  return ok(item);
});

route('POST', '/inventory/items/:id/archive', FARMER, (ctx) => {
  const item = ownedItem(ctx);
  item.archivedAt = now();
  audit(ctx.db, ctx.user, 'inventory.item.archived', 'inventory_item', item.id);
  return ok(item);
});

route('GET', '/inventory/items/:id/movements', FARMER, (ctx) => {
  const item = ownedItem(ctx);
  const q = query(ctx, ['page', 'limit', 'sort']);
  const rows = ctx.db.movements.filter((movement) => movement.itemId === item.id);
  return ok(paginate(sortBy(rows, q.sort, { createdAt: (m) => m.createdAt }, '-createdAt'), q));
});

route('POST', '/inventory/items/:id/movements', FARMER, (ctx) => {
  const key = ctx.req.headers['idempotency-key'];
  if (!key) fail(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key sarlavhasi talab qilinadi');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) fail(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key noto‘g‘ri');
  const item = ownedItem(ctx);
  const hash = canonical({ itemId: item.id, body: ctx.req.body });
  const storeKey = `${ctx.user.id}:inventory.movement.create:${key}`;
  const previous = ctx.db.idempotency[storeKey];
  if (previous) {
    if (previous.hash !== hash) fail(409, 'IDEMPOTENCY_KEY_REUSED', 'Bu kalit boshqa so‘rov uchun ishlatilgan');
    return { status: previous.status, body: previous.body, headers: { 'idempotent-replayed': 'true' } };
  }
  if (item.archivedAt) notFound();
  const record = readBody(ctx, ['type', 'quantity', 'unitCost', 'currency', 'reason']);
  const type = oneOf(record, 'type', MOVEMENTS, true) ?? 'IN';
  const quantity = decimalField(record, 'quantity', 3, true) ?? Decimal.ZERO;
  if (quantity.isZero()) invalid(['quantity must be greater than 0']);
  const unitCost = decimalField(record, 'unitCost', 2);
  const currency = str(record, 'currency', { max: 3 });
  if (unitCost && !currency) invalid(['currency should not be empty']);
  const reason = str(record, 'reason', { max: 500 });
  if (type.startsWith('ADJUSTMENT') && !reason) invalid(['reason should not be empty']);
  const current = Decimal.from(item.quantity);
  const incoming = type === 'IN' || type === 'ADJUSTMENT_IN';
  const next = incoming ? current.add(quantity) : current.sub(quantity);
  if (next.isNegative()) {
    fail(409, 'INSUFFICIENT_STOCK', 'Omborda yetarli miqdor yo‘q', { available: current.toFixed(3) });
  }
  item.quantity = next.toFixed(3);
  item.updatedAt = now();
  // A priced purchase becomes the item's current price.
  if (type === 'IN' && unitCost) item.unitPrice = unitCost.toFixed(2);
  const movement: StockMovement = {
    id: newId(),
    itemId: item.id,
    farmId: item.farmId,
    type,
    quantity: quantity.toFixed(3),
    balanceAfter: item.quantity,
    unitCost: unitCost ? unitCost.toFixed(2) : null,
    currency: currency ?? null,
    reason: reason ?? null,
    actorId: ctx.user.id,
    rationIssueId: null,
    createdAt: now(),
  };
  ctx.db.movements.push(movement);
  audit(ctx.db, ctx.user, incoming ? 'inventory.stock.in' : 'inventory.stock.out', 'stock_movement', movement.id, null, {
    quantity: movement.quantity,
  });
  ctx.db.idempotency[storeKey] = { hash, status: 201, body: movement };
  return ok(movement, 201);
});

// --- rations ---------------------------------------------------------------

const RATION_PROFILES = ['BULL', 'COW', 'RAM', 'EWE', 'OTHER'] as const;
const FEEDING_PURPOSES = ['FATTENING', 'MAINTENANCE', 'MILK', 'BREEDING'] as const;
const PHYSIOLOGICAL_STATES = ['NORMAL', 'PREGNANT', 'LACTATING', 'DRY'] as const;

/** Same configuration as the API (GET /rations/profiles). */
const PROFILE_CONFIG: ProfileConfig[] = [
  { profile: 'BULL', purposes: ['FATTENING', 'MAINTENANCE', 'BREEDING'], states: [], fields: ['averageWeightKg', 'ageMonths'] },
  {
    profile: 'COW',
    purposes: ['MILK', 'MAINTENANCE', 'FATTENING'],
    states: ['NORMAL', 'PREGNANT', 'LACTATING', 'DRY'],
    fields: ['averageWeightKg', 'ageMonths', 'milkYieldLiters'],
  },
  { profile: 'RAM', purposes: ['MAINTENANCE', 'BREEDING', 'FATTENING'], states: [], fields: ['averageWeightKg', 'ageMonths'] },
  {
    profile: 'EWE',
    purposes: ['MAINTENANCE', 'BREEDING', 'FATTENING'],
    states: ['NORMAL', 'PREGNANT', 'LACTATING'],
    fields: ['averageWeightKg', 'ageMonths'],
  },
  {
    profile: 'OTHER',
    purposes: [...FEEDING_PURPOSES],
    states: [...PHYSIOLOGICAL_STATES],
    fields: ['averageWeightKg', 'ageMonths', 'milkYieldLiters'],
  },
];

const DEFAULT_TYPES: Array<Pick<AnimalType, 'profile' | 'name' | 'species' | 'sex'>> = [
  { profile: 'BULL', name: 'Buqa', species: 'CATTLE', sex: 'MALE' },
  { profile: 'COW', name: 'Sigir', species: 'CATTLE', sex: 'FEMALE' },
  { profile: 'RAM', name: 'Qo‘chqor', species: 'SHEEP', sex: 'MALE' },
  { profile: 'EWE', name: 'Qo‘y', species: 'SHEEP', sex: 'FEMALE' },
];

/** Idempotent: the defaults are created once per farm, on the first list. */
function ensureDefaultTypes(db: MockDb, farmId: string): void {
  for (const preset of DEFAULT_TYPES) {
    if (db.rationAnimalTypes.some((type) => type.farmId === farmId && type.isDefault && type.profile === preset.profile))
      continue;
    db.rationAnimalTypes.push({
      id: newId(),
      farmId,
      ...preset,
      isDefault: true,
      archivedAt: null,
      createdAt: now(),
      updatedAt: now(),
    });
  }
}

function ownedAnimalType(ctx: Ctx): AnimalType {
  const farms = ownedFarmIds(ctx);
  const type = ctx.db.rationAnimalTypes.find((candidate) => candidate.id === ctx.params.id && farms.has(candidate.farmId));
  if (!type) notFound();
  return type;
}

function ownedRation(ctx: Ctx): MockRation {
  const farms = ownedFarmIds(ctx);
  const ration = ctx.db.rations.find((candidate) => candidate.id === ctx.params.id && farms.has(candidate.farmId));
  if (!ration) notFound();
  return ration;
}

function presentRation(db: MockDb, ration: MockRation): Ration {
  const type = db.rationAnimalTypes.find((candidate) => candidate.id === ration.animalTypeId);
  if (!type) throw new Error('mock: ration without animal type');
  const last = db.rationIssues
    .filter((issue) => issue.rationId === ration.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))[0];
  return {
    ...ration,
    lastIssue: last ? { id: last.id, createdAt: last.createdAt, days: last.days } : null,
    animalType: { id: type.id, name: type.name, profile: type.profile, species: type.species, sex: type.sex },
    items: [...ration.items]
      .sort((a, b) => a.position - b.position)
      .map((line) => {
        const item = db.items.find((candidate) => candidate.id === line.inventoryItemId);
        if (!item) throw new Error('mock: ration line without inventory item');
        const { id, name, unit, category, quantity, unitPrice, minQuantity, archivedAt } = item;
        return { ...line, item: { id, name, unit, category, quantity, unitPrice, minQuantity, archivedAt } };
      }),
  };
}

function intField(record: Record<string, unknown>, key: string, min: number, max: number, required = false): number | undefined {
  const value = record[key];
  if (value === undefined) {
    if (required) invalid([`${key} should not be empty`]);
    return undefined;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    invalid([`${key} must be an integer between ${min} and ${max}`]);
  return value;
}

const RATION_FIELDS = [
  'animalTypeId',
  'name',
  'animalCount',
  'averageWeightKg',
  'ageMonths',
  'purpose',
  'physiologicalState',
  'milkYieldLiters',
  'days',
  'notes',
  'items',
] as const;

function parameterInvalid(field: string): never {
  return fail(422, 'RATION_PARAMETER_INVALID', 'Bu parametr tanlangan hayvon turiga mos emas', { field });
}

/** Validated ration fields. Creating: all required ones; PATCH: only the keys sent (null clears). */
function readRation(ctx: Ctx, record: Record<string, unknown>, farmId: string, current: MockRation | null): Partial<MockRation> {
  const creating = current === null;
  const next: Partial<MockRation> = {};
  if (creating || record.animalTypeId !== undefined) {
    const type = ctx.db.rationAnimalTypes.find(
      (candidate) => candidate.id === record.animalTypeId && candidate.farmId === farmId && !candidate.archivedAt,
    );
    if (!type) fail(422, 'RATION_ANIMAL_TYPE_INVALID', 'Hayvon turi topilmadi');
    next.animalTypeId = type.id;
  }
  const name = str(record, 'name', { required: creating, max: 100 });
  if (name !== undefined) next.name = name;
  const animalCount = intField(record, 'animalCount', 1, 1_000_000, creating);
  if (animalCount !== undefined) next.animalCount = animalCount;
  if (record.averageWeightKg === null) next.averageWeightKg = null;
  else {
    const weight = decimalField(record, 'averageWeightKg', 2);
    if (weight?.isZero()) invalid(['averageWeightKg must be greater than 0']);
    if (weight) next.averageWeightKg = weight.toFixed(2);
  }
  if (record.ageMonths === null) next.ageMonths = null;
  else {
    const age = intField(record, 'ageMonths', 0, 600);
    if (age !== undefined) next.ageMonths = age;
  }
  const purpose = oneOf(record, 'purpose', FEEDING_PURPOSES, creating);
  if (purpose) next.purpose = purpose;
  if (record.physiologicalState === null) next.physiologicalState = null;
  else {
    const state = oneOf(record, 'physiologicalState', PHYSIOLOGICAL_STATES);
    if (state) next.physiologicalState = state;
  }
  if (record.milkYieldLiters === null) next.milkYieldLiters = null;
  else {
    const milk = decimalField(record, 'milkYieldLiters', 2);
    if (milk) next.milkYieldLiters = milk.toFixed(2);
  }
  const days = intField(record, 'days', 1, 3650, creating);
  if (days !== undefined) next.days = days;
  if (record.notes === null) next.notes = null;
  else {
    const notes = str(record, 'notes', { max: 500 });
    if (notes !== undefined) next.notes = notes || null;
  }
  if (creating || record.items !== undefined) {
    const items = record.items;
    if (!Array.isArray(items) || items.length < 1 || items.length > 20) invalid(['items must contain 1 to 20 elements']);
    const seen = new Set<string>();
    next.items = items.map((entry: unknown, position) => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) invalid(['each item must be an object']);
      const line = entry as Record<string, unknown>;
      const extra = Object.keys(line).filter((key) => key !== 'inventoryItemId' && key !== 'dailyPerAnimal');
      if (extra.length > 0) invalid(extra.map((key) => `items.property ${key} should not exist`));
      const id = line.inventoryItemId;
      if (typeof id !== 'string' || !UUID.test(id)) invalid(['items.inventoryItemId must be a UUID']);
      if (seen.has(id)) fail(400, 'RATION_ITEM_DUPLICATE', 'Bir yem ratsionga ikki marta qo‘shilgan');
      seen.add(id);
      const daily = decimalField(line, 'dailyPerAnimal', 3, true);
      if (!daily || daily.isZero()) invalid(['items.dailyPerAnimal must be greater than 0']);
      const item = ctx.db.items.find(
        (candidate) =>
          candidate.id === id && candidate.farmId === farmId && candidate.category === 'FEED' && !candidate.archivedAt,
      );
      if (!item) fail(422, 'RATION_ITEM_INVALID', 'Yem topilmadi yoki ratsionga qo‘shib bo‘lmaydi', { inventoryItemId: id });
      return { inventoryItemId: id, dailyPerAnimal: daily.toFixed(3), position };
    });
  }

  // The merged ration must fit its animal type's profile (server configuration).
  const merged = { ...current, ...next };
  const profile = ctx.db.rationAnimalTypes.find((type) => type.id === merged.animalTypeId)?.profile;
  const config = PROFILE_CONFIG.find((candidate) => candidate.profile === profile);
  if (config) {
    if (merged.purpose && !config.purposes.includes(merged.purpose)) parameterInvalid('purpose');
    if (merged.physiologicalState && !config.states.includes(merged.physiologicalState)) parameterInvalid('physiologicalState');
    if (merged.milkYieldLiters != null && !config.fields.includes('milkYieldLiters')) parameterInvalid('milkYieldLiters');
  }
  return next;
}

// Static segments first: '/rations/:id' would match them too.
route('GET', '/rations/profiles', FARMER, () => ok(PROFILE_CONFIG));

route('GET', '/rations/animal-types', FARMER, (ctx) => {
  const q = query(ctx, ['farmId', 'includeArchived']);
  if (!q.farmId || !UUID.test(q.farmId)) invalid(['farmId must be a UUID']);
  const farm = ownedFarm(ctx, q.farmId);
  if (!farm.archivedAt) ensureDefaultTypes(ctx.db, farm.id);
  const includeArchived = boolParam(q.includeArchived) ?? false;
  const order = (type: AnimalType) =>
    type.isDefault ? DEFAULT_TYPES.findIndex((preset) => preset.profile === type.profile) : DEFAULT_TYPES.length;
  const types = ctx.db.rationAnimalTypes
    .filter((type) => type.farmId === farm.id && (includeArchived || !type.archivedAt))
    .sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  return ok(types);
});

route('POST', '/rations/animal-types', FARMER, (ctx) => {
  const record = readBody(ctx, ['farmId', 'name', 'species', 'profile', 'sex']);
  const farm = ownedFarm(ctx, record.farmId);
  if (farm.archivedAt) notFound();
  const name = str(record, 'name', { required: true, max: 60 }) ?? '';
  const taken = ctx.db.rationAnimalTypes.some(
    (type) => type.farmId === farm.id && !type.archivedAt && type.name.toLocaleLowerCase('uz') === name.toLocaleLowerCase('uz'),
  );
  if (taken) fail(409, 'RATION_ANIMAL_TYPE_EXISTS', 'Bunday nomli hayvon turi bor');
  const type: AnimalType = {
    id: newId(),
    farmId: farm.id,
    name,
    profile: oneOf(record, 'profile', RATION_PROFILES) ?? 'OTHER',
    species: oneOf(record, 'species', SPECIES, true) ?? 'OTHER',
    sex: oneOf(record, 'sex', ['MALE', 'FEMALE'] as const) ?? null,
    isDefault: false,
    archivedAt: null,
    createdAt: now(),
    updatedAt: now(),
  };
  ctx.db.rationAnimalTypes.push(type);
  audit(ctx.db, ctx.user, 'ration.animal_type.created', 'ration_animal_type', type.id, null, { name: type.name });
  return ok(type, 201);
});

route('POST', '/rations/animal-types/:id/archive', FARMER, (ctx) => {
  const type = ownedAnimalType(ctx);
  if (type.isDefault) fail(409, 'RATION_ANIMAL_TYPE_DEFAULT', 'Asosiy hayvon turlarini o‘chirib bo‘lmaydi');
  if (type.archivedAt) fail(409, 'RATION_ANIMAL_TYPE_ARCHIVED', 'Hayvon turi allaqachon o‘chirilgan');
  if (ctx.db.rations.some((ration) => ration.animalTypeId === type.id && !ration.archivedAt))
    fail(409, 'RATION_ANIMAL_TYPE_IN_USE', 'Bu turda ratsionlar bor — avval ularni o‘chiring');
  type.archivedAt = now();
  type.updatedAt = now();
  audit(ctx.db, ctx.user, 'ration.animal_type.archived', 'ration_animal_type', type.id);
  return ok(type);
});

route('GET', '/rations', FARMER, (ctx) => {
  const q = query(ctx, ['page', 'limit', 'sort', 'farmId', 'animalTypeId', 'includeArchived']);
  const farms = ownedFarmIds(ctx);
  const includeArchived = boolParam(q.includeArchived) ?? false;
  const rows = ctx.db.rations.filter(
    (ration) =>
      farms.has(ration.farmId) &&
      (!q.farmId || ration.farmId === q.farmId) &&
      (!q.animalTypeId || ration.animalTypeId === q.animalTypeId) &&
      (includeArchived || !ration.archivedAt),
  );
  const sorted = sortBy(
    rows,
    q.sort,
    { createdAt: (r) => r.createdAt, updatedAt: (r) => r.updatedAt, name: (r) => r.name },
    '-updatedAt',
  );
  const page = paginate(sorted, q);
  return ok({ ...page, items: page.items.map((ration) => presentRation(ctx.db, ration)) });
});

route('POST', '/rations', FARMER, (ctx) => {
  const record = readBody(ctx, ['farmId', ...RATION_FIELDS]);
  const farm = ownedFarm(ctx, record.farmId);
  if (farm.archivedAt) notFound();
  const fields = readRation(ctx, record, farm.id, null);
  const ration = {
    id: newId(),
    farmId: farm.id,
    averageWeightKg: null,
    ageMonths: null,
    physiologicalState: null,
    milkYieldLiters: null,
    notes: null,
    ...fields,
    archivedAt: null,
    createdAt: now(),
    updatedAt: now(),
  } as MockRation;
  ctx.db.rations.push(ration);
  audit(ctx.db, ctx.user, 'ration.created', 'ration', ration.id, null, { name: ration.name });
  return ok(presentRation(ctx.db, ration), 201);
});

route('GET', '/rations/:id', FARMER, (ctx) => ok(presentRation(ctx.db, ownedRation(ctx))));

route('PATCH', '/rations/:id', FARMER, (ctx) => {
  const ration = ownedRation(ctx);
  if (ration.archivedAt) fail(409, 'RATION_ARCHIVED', 'Ratsion o‘chirilgan');
  const record = readBody(ctx, RATION_FIELDS);
  Object.assign(ration, readRation(ctx, record, ration.farmId, ration), { updatedAt: now() });
  audit(ctx.db, ctx.user, 'ration.updated', 'ration', ration.id);
  return ok(presentRation(ctx.db, ration));
});

route('POST', '/rations/:id/copy', FARMER, (ctx) => {
  const source = ownedRation(ctx);
  if (source.archivedAt) fail(409, 'RATION_ARCHIVED', 'Ratsion o‘chirilgan');
  const record = readBody(ctx, ['name']);
  const items = source.items
    .filter((line) => !ctx.db.items.find((item) => item.id === line.inventoryItemId)?.archivedAt)
    .map((line, position) => ({ ...line, position }));
  if (items.length === 0) fail(422, 'RATION_ITEM_INVALID', 'Ratsiondagi yemlar omborda qolmagan');
  const copy: MockRation = {
    ...source,
    id: newId(),
    name: (str(record, 'name', { max: 100 }) || `${source.name} (nusxa)`).slice(0, 100),
    items,
    archivedAt: null,
    createdAt: now(),
    updatedAt: now(),
  };
  ctx.db.rations.push(copy);
  audit(ctx.db, ctx.user, 'ration.created', 'ration', copy.id, null, { name: copy.name, copiedFrom: source.id });
  return ok(presentRation(ctx.db, copy), 201);
});

route('POST', '/rations/:id/archive', FARMER, (ctx) => {
  const ration = ownedRation(ctx);
  if (ration.archivedAt) fail(409, 'RATION_ARCHIVED', 'Ratsion allaqachon o‘chirilgan');
  ration.archivedAt = now();
  ration.updatedAt = now();
  audit(ctx.db, ctx.user, 'ration.archived', 'ration', ration.id);
  return ok(presentRation(ctx.db, ration));
});

route('POST', '/rations/:id/issue', FARMER, (ctx) => {
  const key = ctx.req.headers['idempotency-key'];
  if (!key) fail(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key sarlavhasi talab qilinadi');
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(key)) fail(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key noto‘g‘ri');
  const ration = ownedRation(ctx);
  const hash = canonical({ rationId: ration.id, body: ctx.req.body });
  const storeKey = `${ctx.user.id}:rations.issue.create:${key}`;
  const previous = ctx.db.idempotency[storeKey];
  if (previous) {
    if (previous.hash !== hash) fail(409, 'IDEMPOTENCY_KEY_REUSED', 'Bu kalit boshqa so‘rov uchun ishlatilgan');
    return { status: previous.status, body: previous.body, headers: { 'idempotent-replayed': 'true' } };
  }
  if (ration.archivedAt) fail(409, 'RATION_ARCHIVED', 'Ratsion o‘chirilgan');
  const record = readBody(ctx, ['days']);
  const days = intField(record, 'days', 1, 3650, true) ?? 1;
  const lines = ration.items.map((line) => {
    const item = ctx.db.items.find((candidate) => candidate.id === line.inventoryItemId);
    if (!item) throw new Error('mock: ration line without inventory item');
    if (item.archivedAt) fail(409, 'RATION_ITEM_ARCHIVED', 'Ratsiondagi yem arxivlangan', { inventoryItemId: item.id });
    const required = Decimal.from(line.dailyPerAnimal).mul(Decimal.from(ration.animalCount)).mul(Decimal.from(days));
    return { item, required };
  });
  // All or nothing: one short feed refuses the whole issue.
  const short = lines.filter(({ item, required }) => required.gt(Decimal.from(item.quantity)));
  if (short.length > 0) {
    fail(409, 'INSUFFICIENT_STOCK', 'Omborda yetarli qoldiq yo‘q', {
      items: short.map(({ item, required }) => ({
        inventoryItemId: item.id,
        name: item.name,
        required: required.toFixed(3),
        available: item.quantity,
      })),
    });
  }
  const issue: MockRationIssue = {
    id: newId(),
    rationId: ration.id,
    farmId: ration.farmId,
    days,
    animalCount: ration.animalCount,
    actorId: ctx.user.id,
    createdAt: now(),
  };
  ctx.db.rationIssues.push(issue);
  const movements = lines.map(({ item, required }): StockMovement => {
    item.quantity = Decimal.from(item.quantity).sub(required).toFixed(3);
    item.updatedAt = now();
    const movement: StockMovement = {
      id: newId(),
      itemId: item.id,
      farmId: item.farmId,
      type: 'OUT',
      quantity: required.toFixed(3),
      balanceAfter: item.quantity,
      unitCost: null,
      currency: null,
      reason: `Ratsion: ${ration.name} — ${days} kun`,
      actorId: ctx.user.id,
      rationIssueId: issue.id,
      createdAt: now(),
    };
    ctx.db.movements.push(movement);
    audit(ctx.db, ctx.user, 'inventory.stock.out', 'stock_movement', movement.id, null, { quantity: movement.quantity });
    return movement;
  });
  audit(ctx.db, ctx.user, 'ration.issued', 'ration_issue', issue.id, null, { rationId: ration.id, days });
  const body = { ...issue, movements };
  ctx.db.idempotency[storeKey] = { hash, status: 201, body };
  return ok(body, 201);
});

route('GET', '/rations/:id/issues', FARMER, (ctx) => {
  const ration = ownedRation(ctx);
  const q = query(ctx, ['page', 'limit']);
  const rows = ctx.db.rationIssues
    .filter((issue) => issue.rationId === ration.id)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  const page = paginate(rows, q);
  return ok({
    ...page,
    items: page.items.map((issue) => ({
      ...issue,
      movements: ctx.db.movements.filter((movement) => movement.rationIssueId === issue.id),
    })),
  });
});

// --- diseases ("Molim kasal" reference text) --------------------------------

const DISEASE_ANIMAL_VALUES = ['CATTLE', 'CALF', 'SHEEP', 'LAMB'] as const;

function diseaseSummary(disease: ReturnType<typeof diseaseCatalog>['diseases'][number]) {
  const { number, groupNumber, title, name, scientificNames, symptoms, animals, status } = disease;
  return { number, groupNumber, title, name, scientificNames, symptoms, animals, status };
}

// Static segments first: '/diseases/:number' would match them too.
route('GET', '/diseases/groups', ALL, () => ok(diseaseCatalog().groups));
route('GET', '/diseases/source', ALL, () => ok(diseaseCatalog().source));

route('GET', '/diseases', ALL, (ctx) => {
  const q = query(ctx, ['animal', 'groupNumber', 'q']);
  const animal = oneOf(q, 'animal', DISEASE_ANIMAL_VALUES);
  const groupNumber = q.groupNumber === undefined ? undefined : Number(q.groupNumber);
  if (groupNumber !== undefined && (!Number.isInteger(groupNumber) || groupNumber < 1))
    invalid(['groupNumber must be a positive integer']);
  if ((q.q ?? '').length > 100) invalid(['q must be shorter than or equal to 100 characters']);
  const words = normalizeSearch(q.q ?? '')
    .split(' ')
    .filter(Boolean);
  return ok(
    diseaseCatalog()
      .diseases.filter(
        (disease) =>
          (!animal || disease.animals.includes(animal)) &&
          (!groupNumber || disease.groupNumber === groupNumber) &&
          words.every((word) => disease.searchText.includes(word)),
      )
      .map(diseaseSummary),
  );
});

route('GET', '/diseases/:number', ALL, (ctx) => {
  const number = Number(ctx.params.number);
  if (!/^\d+$/.test(ctx.params.number ?? '')) fail(400, 'INVALID_ID', 'Identifikator noto‘g‘ri');
  const disease = diseaseCatalog().diseases.find((candidate) => candidate.number === number);
  if (!disease) notFound();
  const { searchText: _searchText, ...details } = disease;
  return ok(details);
});

// --- vet medicines ---------------------------------------------------------

function visibleMedicines(ctx: Ctx): Medicine[] {
  return ctx.user.role === 'FARMER' ? ctx.db.medicines.filter((medicine) => medicine.status === 'APPROVED') : ctx.db.medicines;
}

route('GET', '/vet/medicines', ALL, (ctx) => {
  const q = query(ctx, ['page', 'limit']);
  return ok(paginate(visibleMedicines(ctx), q));
});

route('GET', '/vet/medicines/:id', ALL, (ctx) => {
  const medicine = visibleMedicines(ctx).find((candidate) => candidate.id === ctx.params.id);
  if (!medicine) notFound();
  return ok(medicine);
});

route('POST', '/vet/medicines', MED_MANAGERS, (ctx) => {
  const record = readBody(ctx, ['name', 'activeIngredient', 'form', 'concentration', 'withdrawalMeatDays', 'withdrawalMilkDays']);
  for (const key of ['withdrawalMeatDays', 'withdrawalMilkDays']) {
    const value = record[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) invalid([`${key} must be a non-negative integer`]);
  }
  const medicine: Medicine = {
    id: newId(),
    name: str(record, 'name', { required: true, max: 150 }) ?? '',
    activeIngredient: str(record, 'activeIngredient', { required: true, max: 150 }) ?? '',
    form: str(record, 'form', { max: 50 }) ?? null,
    concentration: str(record, 'concentration', { max: 50 }) ?? null,
    withdrawalMeatDays: record.withdrawalMeatDays as number,
    withdrawalMilkDays: record.withdrawalMilkDays as number,
    status: 'DRAFT',
    isDemo: false,
    approvedAt: null,
    createdAt: now(),
    updatedAt: now(),
  };
  ctx.db.medicines.push(medicine);
  audit(ctx.db, ctx.user, 'medicine.created', 'medicine', medicine.id, null, { name: medicine.name });
  return ok(medicine, 201);
});

route('POST', '/vet/medicines/:id/approve', ['VET'], (ctx) => {
  const medicine = ctx.db.medicines.find((candidate) => candidate.id === ctx.params.id);
  if (!medicine) notFound();
  if (medicine.isDemo) fail(409, 'CONSTRAINT_VIOLATION', 'Namuna dorini tasdiqlab bo‘lmaydi');
  if (medicine.status !== 'DRAFT') fail(409, 'MEDICINE_IMMUTABLE', 'Faqat qoralama tasdiqlanadi');
  medicine.status = 'APPROVED';
  medicine.approvedAt = now();
  audit(ctx.db, ctx.user, 'medicine.approved', 'medicine', medicine.id, { status: 'DRAFT' }, { status: 'APPROVED' });
  return ok(medicine);
});

route('POST', '/vet/medicines/:id/archive', MED_MANAGERS, (ctx) => {
  const medicine = ctx.db.medicines.find((candidate) => candidate.id === ctx.params.id);
  if (!medicine) notFound();
  const previous = medicine.status;
  medicine.status = 'ARCHIVED';
  audit(ctx.db, ctx.user, 'medicine.archived', 'medicine', medicine.id, { status: previous }, { status: 'ARCHIVED' });
  return ok(medicine);
});

// --- admin users -----------------------------------------------------------

route('GET', '/admin/users', STAFF_READ, (ctx) => {
  const q = query(ctx, ['page', 'limit', 'sort', 'role', 'status', 'phone', 'isDemo']);
  const isDemo = boolParam(q.isDemo);
  const filtered = ctx.db.users.filter(
    (user) =>
      (!ctx.user.isDemo || user.isDemo) &&
      (!q.role || user.role === q.role) &&
      (!q.status || user.status === q.status) &&
      (!q.phone || user.phone === q.phone) &&
      (isDemo === undefined || user.isDemo === isDemo),
  );
  const sorted = sortBy(
    filtered,
    q.sort,
    { createdAt: (u) => u.createdAt, fullName: (u) => u.fullName, lastLoginAt: (u) => u.lastLoginAt },
    '-createdAt',
  );
  const page = paginate(sorted.map(publicUser), q);
  audit(ctx.db, ctx.user, 'user.list_viewed', 'user', null, null, { role: q.role ?? null, status: q.status ?? null });
  return ok(page);
});

route('GET', '/admin/users/:id', STAFF_READ, (ctx) => {
  const target = targetUser(ctx, true);
  audit(ctx.db, ctx.user, 'user.viewed', 'user', target.id);
  return ok({ ...publicUser(target), sessionCount: ctx.db.sessions.filter((s) => s.userId === target.id && !s.revoked).length });
});

route('POST', '/admin/users', ADMINS, (ctx) => {
  const record = readBody(ctx, ['phone', 'fullName', 'role', 'password']);
  const role = oneOf(record, 'role', ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'VET', 'FARMER'] as const, true) ?? 'FARMER';
  if (ctx.user.role === 'ADMIN' && MFA_ROLES.includes(role)) forbidden();
  const phone = str(record, 'phone', { required: true, max: 32 }) ?? '';
  if (!/^\+998\d{9}$/.test(phone)) invalid(['phone must be a valid Uzbek phone number']);
  if (ctx.db.users.some((candidate) => candidate.phone === phone)) fail(409, 'CONFLICT', 'Bunday ma’lumot allaqachon mavjud');
  const created: MockUser = {
    id: newId(),
    phone,
    email: null,
    fullName: str(record, 'fullName', { required: true, max: 100 }) ?? '',
    role,
    status: 'ACTIVE',
    phoneVerifiedAt: now(),
    mfaEnabled: false,
    isDemo: ctx.user.isDemo,
    lastLoginAt: null,
    createdAt: now(),
    updatedAt: now(),
    blockedAt: null,
    archivedAt: null,
    password: String(record.password),
  };
  ctx.db.users.push(created);
  audit(ctx.db, ctx.user, 'user.created', 'user', created.id, null, { role });
  return ok(publicUser(created), 201);
});

route('PATCH', '/admin/users/:id/role', ADMINS, (ctx) => {
  const target = targetUser(ctx);
  assertCanActOn(ctx, target);
  const role =
    oneOf(readBody(ctx, ['role']), 'role', ['SUPER_ADMIN', 'ADMIN', 'SUPPORT', 'VET', 'FARMER'] as const, true) ?? target.role;
  if (ctx.user.role === 'ADMIN' && MFA_ROLES.includes(role)) forbidden();
  const old = target.role;
  target.role = role;
  revokeUserSessions(ctx.db, target.id);
  audit(ctx.db, ctx.user, 'user.role.changed', 'user', target.id, { role: old }, { role });
  return ok(publicUser(target));
});

route('POST', '/admin/users/:id/block', ADMINS, (ctx) => {
  const target = targetUser(ctx);
  assertCanActOn(ctx, target);
  const reason = str(readBody(ctx, ['reason']), 'reason', { required: true, max: 500 });
  target.status = 'BLOCKED';
  target.blockedAt = now();
  revokeUserSessions(ctx.db, target.id);
  audit(ctx.db, ctx.user, 'user.blocked', 'user', target.id, { status: 'ACTIVE' }, { status: 'BLOCKED', reason });
  return ok(publicUser(target));
});

route('POST', '/admin/users/:id/unblock', ADMINS, (ctx) => {
  const target = targetUser(ctx);
  assertCanActOn(ctx, target);
  readBody(ctx, []);
  if (!target.phoneVerifiedAt) fail(409, 'PHONE_NOT_VERIFIED', 'Telefon tasdiqlanmagan');
  target.status = 'ACTIVE';
  target.blockedAt = null;
  audit(ctx.db, ctx.user, 'user.unblocked', 'user', target.id, { status: 'BLOCKED' }, { status: 'ACTIVE' });
  return ok(publicUser(target));
});

route('POST', '/admin/users/:id/archive', ADMINS, (ctx) => {
  const target = targetUser(ctx);
  assertCanActOn(ctx, target);
  const reason = str(readBody(ctx, ['reason']), 'reason', { required: true, max: 500 });
  target.status = 'ARCHIVED';
  target.archivedAt = now();
  revokeUserSessions(ctx.db, target.id);
  audit(ctx.db, ctx.user, 'user.archived', 'user', target.id, null, { reason });
  return ok(publicUser(target));
});

route('POST', '/admin/users/:id/sessions/revoke', ADMINS, (ctx) => {
  const target = targetUser(ctx);
  assertCanActOn(ctx, target);
  revokeUserSessions(ctx.db, target.id);
  audit(ctx.db, ctx.user, 'user.sessions.revoked', 'user', target.id);
  return ok(undefined, 204);
});

route('POST', '/admin/users/:id/mfa/reset', ['SUPER_ADMIN'], (ctx) => {
  const target = targetUser(ctx);
  assertCanActOn(ctx, target);
  target.mfaEnabled = false;
  revokeUserSessions(ctx.db, target.id);
  audit(ctx.db, ctx.user, 'auth.mfa.reset', 'user', target.id);
  return ok(undefined, 204);
});

route('GET', '/admin/audit-logs', ADMINS, (ctx) => {
  const q = query(ctx, ['page', 'limit', 'sort', 'action', 'actorId', 'resourceType', 'resourceId', 'from', 'to']);
  const filtered = ctx.db.auditLogs.filter(
    (log) =>
      (!q.action || log.action === q.action) &&
      (!q.actorId || log.actorId === q.actorId) &&
      (!q.resourceType || log.resourceType === q.resourceType) &&
      (!q.resourceId || log.resourceId === q.resourceId) &&
      (!q.from || log.timestamp >= q.from) &&
      (!q.to || log.timestamp <= q.to),
  );
  return ok(paginate(sortBy(filtered, q.sort, { timestamp: (log) => log.timestamp }, '-timestamp'), q));
});

// ---------------------------------------------------------------------------

export interface MockServer {
  db: MockDb;
  handle(request: MockRequest): MockResponse;
}

export function createMockServer(db: MockDb = createSeedDb()): MockServer {
  return {
    db,
    handle(request) {
      const candidates = routes.filter((candidate) => candidate.pattern.test(request.path));
      const matched = candidates.find((candidate) => candidate.method === request.method);
      try {
        if (!matched) {
          if (candidates.length > 0) fail(405, 'METHOD_NOT_ALLOWED', 'Bu amal qo‘llab-quvvatlanmaydi');
          notFound();
        }
        const values = matched.pattern.exec(request.path)?.slice(1) ?? [];
        const params = Object.fromEntries(matched.keys.map((key, index) => [key, decodeURIComponent(values[index] ?? '')]));
        if (params.id !== undefined && !UUID.test(params.id) && !request.path.startsWith('/auth/sessions')) {
          fail(400, 'INVALID_ID', 'Identifikator noto‘g‘ri');
        }
        if (matched.access === 'public') return (matched.handler as PublicHandler)({ req: request, params, db });
        const { user, session } = authenticate(db, request);
        if (!matched.access.includes(user.role)) forbidden();
        return (matched.handler as Handler)({ req: request, params, db, user, session });
      } catch (error) {
        if (error instanceof MockHttpError) {
          const headers: Record<string, string> = {};
          if (error.status === 429) headers['retry-after'] = '30';
          return { status: error.status, body: error.body, headers };
        }
        throw error;
      }
    },
  };
}
