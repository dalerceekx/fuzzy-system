import { AppException } from '../common/errors/app.exception.js';
import { UserRole, UserStatus } from '../generated/prisma/enums.js';
import {
  assertActorAllowed,
  assertMayActOn,
  assertMayGrant,
  reducesActiveSuperAdmins,
  type PolicyUser,
} from './admin-policy.js';

const { SUPER_ADMIN, ADMIN, SUPPORT, VET, FARMER } = UserRole;

function user(role: UserRole, overrides: Partial<PolicyUser> = {}): PolicyUser {
  return {
    id: `${role}-${Math.random()}`,
    role,
    status: UserStatus.ACTIVE,
    isDemo: false,
    ...overrides,
  };
}

function errorOf(fn: () => void): { status: number; code: string } | null {
  try {
    fn();
    return null;
  } catch (err) {
    if (!(err instanceof AppException)) throw err;
    return { status: err.getStatus(), code: err.code };
  }
}

describe('assertActorAllowed', () => {
  it('accepts an ACTIVE actor holding an allowed role', () => {
    expect(errorOf(() => assertActorAllowed(user(ADMIN), [ADMIN]))).toBeNull();
  });

  it.each([
    ['missing actor', undefined],
    ['role no longer allowed', user(FARMER)],
    ['blocked actor', user(ADMIN, { status: UserStatus.BLOCKED })],
    ['archived actor', user(ADMIN, { status: UserStatus.ARCHIVED })],
  ])('refuses a %s with 403', (_name, actor) => {
    expect(
      errorOf(() => assertActorAllowed(actor, [SUPER_ADMIN, ADMIN])),
    ).toEqual({ status: 403, code: 'FORBIDDEN' });
  });
});

describe('assertMayActOn', () => {
  it('forbids acting on yourself', () => {
    const actor = user(SUPER_ADMIN);
    expect(errorOf(() => assertMayActOn(actor, { ...actor }))).toEqual({
      status: 403,
      code: 'SELF_ACTION_FORBIDDEN',
    });
  });

  it.each([
    ['missing target', undefined],
    ['archived target', user(FARMER, { status: UserStatus.ARCHIVED })],
  ])('reports a %s as 404', (_name, target) => {
    expect(errorOf(() => assertMayActOn(user(SUPER_ADMIN), target))).toEqual({
      status: 404,
      code: 'NOT_FOUND',
    });
  });

  it('hides real users from demo actors (404, even for privileged targets)', () => {
    const demoAdmin = user(SUPER_ADMIN, { isDemo: true });
    expect(errorOf(() => assertMayActOn(demoAdmin, user(FARMER)))).toEqual({
      status: 404,
      code: 'NOT_FOUND',
    });
    expect(
      errorOf(() => assertMayActOn(demoAdmin, user(FARMER, { isDemo: true }))),
    ).toBeNull();
  });

  it.each([ADMIN, SUPER_ADMIN])('forbids an ADMIN acting on %s', (role) => {
    expect(errorOf(() => assertMayActOn(user(ADMIN), user(role)))).toEqual({
      status: 403,
      code: 'FORBIDDEN',
    });
  });

  it.each([SUPPORT, VET, FARMER])('lets an ADMIN act on %s', (role) => {
    expect(errorOf(() => assertMayActOn(user(ADMIN), user(role)))).toBeNull();
  });

  it.each([SUPER_ADMIN, ADMIN, SUPPORT, VET, FARMER])(
    'lets a SUPER_ADMIN act on another %s',
    (role) => {
      expect(
        errorOf(() => assertMayActOn(user(SUPER_ADMIN), user(role))),
      ).toBeNull();
    },
  );
});

describe('assertMayGrant', () => {
  it.each([SUPER_ADMIN, ADMIN, SUPPORT, VET, FARMER])(
    'SUPER_ADMIN may grant %s',
    (role) => {
      expect(errorOf(() => assertMayGrant(SUPER_ADMIN, role))).toBeNull();
    },
  );

  it.each([SUPER_ADMIN, ADMIN])('ADMIN may not grant %s', (role) => {
    expect(errorOf(() => assertMayGrant(ADMIN, role))).toEqual({
      status: 403,
      code: 'FORBIDDEN',
    });
  });

  it.each([SUPPORT, VET, FARMER])('ADMIN may grant %s', (role) => {
    expect(errorOf(() => assertMayGrant(ADMIN, role))).toBeNull();
  });
});

describe('reducesActiveSuperAdmins', () => {
  const activeSuperAdmin = { role: SUPER_ADMIN, status: UserStatus.ACTIVE };

  it.each([
    [{ role: ADMIN }],
    [{ role: FARMER }],
    [{ status: UserStatus.BLOCKED }],
    [{ status: UserStatus.ARCHIVED }],
  ])('is true for an active SUPER_ADMIN changed by %o', (next) => {
    expect(reducesActiveSuperAdmins(activeSuperAdmin, next)).toBe(true);
  });

  it('is false when the target stays an active SUPER_ADMIN', () => {
    expect(
      reducesActiveSuperAdmins(activeSuperAdmin, { role: SUPER_ADMIN }),
    ).toBe(false);
  });

  it('is false for targets that are not active SUPER_ADMINs', () => {
    expect(
      reducesActiveSuperAdmins(
        { role: SUPER_ADMIN, status: UserStatus.BLOCKED },
        { status: UserStatus.ARCHIVED },
      ),
    ).toBe(false);
    expect(
      reducesActiveSuperAdmins(
        { role: ADMIN, status: UserStatus.ACTIVE },
        { role: FARMER },
      ),
    ).toBe(false);
  });
});
