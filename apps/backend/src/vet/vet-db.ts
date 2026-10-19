import { Errors } from '../common/errors/app.exception.js';
import { Prisma } from '../generated/prisma/client.js';
import { UserRole, UserStatus } from '../generated/prisma/enums.js';
import type { Tx } from '../prisma/prisma.service.js';

/** May create/edit/archive clinical content (approval is VET only). */
export const VET_EDITOR_ROLES: readonly UserRole[] = Object.freeze([
  UserRole.VET,
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
]);

export const VET_APPROVER_ROLES: readonly UserRole[] = Object.freeze([
  UserRole.VET,
]);

export interface LockedActor {
  id: string;
  role: UserRole;
  isDemo: boolean;
}

/**
 * Re-reads the actor inside the transaction: the guard checked the role
 * earlier, and a user demoted or blocked since then must not mutate
 * clinical data. FOR SHARE makes a concurrent role/status change wait for
 * this transaction to finish.
 */
export async function lockActor(
  tx: Tx,
  userId: string,
  allowed: readonly UserRole[],
): Promise<LockedActor> {
  const [actor] = await tx.$queryRaw<
    Array<LockedActor & { status: UserStatus }>
  >`
    SELECT id, role, status, is_demo AS "isDemo"
    FROM users WHERE id = ${userId}::uuid FOR SHARE`;
  if (
    !actor ||
    actor.status !== UserStatus.ACTIVE ||
    !allowed.includes(actor.role)
  ) {
    throw Errors.forbidden();
  }
  return { id: actor.id, role: actor.role, isDemo: actor.isDemo };
}

/**
 * Demo and real clinical content never mix: a demo account cannot touch
 * real medicines/protocols (and vice versa), so demo text can never reach
 * content a VET later approves. Out-of-scope rows look like unknown ids.
 */
export function assertSameDemoScope(
  actor: Pick<LockedActor, 'isDemo'>,
  targetIsDemo: boolean,
): void {
  if (actor.isDemo !== targetIsDemo) throw Errors.notFound();
}

type LockableTable =
  'medicines' | 'protocols' | 'protocol_versions' | 'inventory_items';

/**
 * Row locks by id (in id order, so concurrent lockers cannot deadlock).
 * `table` is a compile-time constant, never user input. Returns the ids
 * that exist.
 */
export async function lockRows(
  tx: Tx,
  table: LockableTable,
  ids: readonly string[],
  mode: 'UPDATE' | 'SHARE',
): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id::text AS id FROM ${Prisma.raw(`"${table}"`)}
    WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
    ORDER BY id
    FOR ${Prisma.raw(mode === 'UPDATE' ? 'UPDATE' : 'SHARE')}`;
  return rows.map((row) => row.id);
}

/** Single-row lock; false when the row does not exist. */
export async function lockRow(
  tx: Tx,
  table: LockableTable,
  id: string,
  mode: 'UPDATE' | 'SHARE' = 'UPDATE',
): Promise<boolean> {
  return (await lockRows(tx, table, [id], mode)).length === 1;
}

/**
 * Escapes LIKE wildcards for Prisma `contains`/`startsWith`: Prisma passes
 * the value into the pattern verbatim (verified against PostgreSQL), so a
 * user-supplied '%' or '_' would otherwise match anything. Backslash is
 * PostgreSQL's default LIKE escape character.
 */
export function likeLiteral(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}
