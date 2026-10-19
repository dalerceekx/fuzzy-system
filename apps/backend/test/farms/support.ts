import type {
  Animal,
  Farm,
  Prisma,
} from '../../src/generated/prisma/client.js';
import { UserRole } from '../../src/generated/prisma/enums.js';
import type { TestApp } from '../utils/app.js';
import { loginAs } from '../utils/auth.js';
import { createUser } from '../utils/factories.js';

export interface Actor {
  id: string;
  auth: { Authorization: string };
}

/** A fresh ACTIVE user of `role` with a live session. */
export async function actor(
  testApp: TestApp,
  role: UserRole = UserRole.FARMER,
): Promise<Actor> {
  const { user } = await createUser(testApp.prisma, {
    role,
    mfaEnabled: role === UserRole.ADMIN || role === UserRole.SUPER_ADMIN,
  });
  return { id: user.id, auth: (await loginAs(testApp, user)).authHeader };
}

/** Error body without the per-request id, for "same body" comparisons. */
export function errorBody(body: Record<string, unknown>) {
  const { requestId, ...rest } = body;
  expect(typeof requestId).toBe('string');
  return rest;
}

/** Full DB row snapshots, for "no state changed" assertions. */
export function farmRow(testApp: TestApp, id: string): Promise<Farm | null> {
  return testApp.prisma.farm.findUnique({ where: { id } });
}

export function animalRow(
  testApp: TestApp,
  id: string,
): Promise<Animal | null> {
  return testApp.prisma.animal.findUnique({ where: { id } });
}

/**
 * Forces a race interleaving: runs `hold` inside a DB transaction, fires
 * `request` while the transaction's row locks are held, checks that the
 * request is still blocked after `holdMs`, then commits and returns the
 * request's result.
 */
export async function whileLocked<T>(
  testApp: TestApp,
  hold: (tx: Prisma.TransactionClient) => Promise<unknown>,
  request: () => PromiseLike<T>,
  holdMs = 500,
): Promise<T> {
  let pending!: Promise<T>;
  let settled = false;
  await testApp.prisma.$transaction(
    async (tx) => {
      await hold(tx);
      pending = Promise.resolve(request()).finally(() => {
        settled = true;
      });
      await new Promise((resolve) => setTimeout(resolve, holdMs));
      expect(settled).toBe(false);
    },
    { timeout: holdMs + 10_000 },
  );
  return pending;
}
