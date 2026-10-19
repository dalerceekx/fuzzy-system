import { Errors } from '../common/errors/app.exception.js';
import { Prisma } from '../generated/prisma/client.js';
import type { RationProfile } from '../generated/prisma/enums.js';
import type { PrismaService, Tx } from '../prisma/prisma.service.js';
import { RationErrors } from './rations.errors.js';
import type { RationLastIssue } from './rations.presenter.js';

// Row locks shared by the rations services. Ownership is always part of the
// locking query, so another farmer's row and an unknown id look the same.

export interface LockedFarm {
  id: string;
  archivedAt: Date | null;
}

/**
 * Owned farm (archived or not) locked FOR SHARE: a concurrent farm archive
 * (FOR UPDATE) waits for this transaction. 404 otherwise.
 */
export async function lockOwnedFarm(
  tx: Tx,
  ownerId: string,
  farmId: string,
): Promise<LockedFarm> {
  const [farm] = await tx.$queryRaw<LockedFarm[]>`
    SELECT id, archived_at AS "archivedAt" FROM farms
    WHERE id = ${farmId}::uuid AND owner_id = ${ownerId}::uuid
    FOR SHARE`;
  if (!farm) throw Errors.notFound();
  return farm;
}

/** `lockOwnedFarm` for writes: an archived farm is a 404 too. */
export async function lockActiveFarm(
  tx: Tx,
  ownerId: string,
  farmId: string,
): Promise<string> {
  const farm = await lockOwnedFarm(tx, ownerId, farmId);
  if (farm.archivedAt) throw Errors.notFound();
  return farm.id;
}

/**
 * Non-archived animal type of `farmId`, locked FOR SHARE so it cannot be
 * archived while a ration is attached to it; else 422.
 */
export async function lockAnimalType(
  tx: Tx,
  farmId: string,
  animalTypeId: string,
): Promise<{ id: string; profile: RationProfile }> {
  const [type] = await tx.$queryRaw<
    Array<{ id: string; profile: RationProfile }>
  >`
    SELECT t.id, t.profile::text AS profile FROM ration_animal_types t
    WHERE t.id = ${animalTypeId}::uuid
      AND t.farm_id = ${farmId}::uuid
      AND t.archived_at IS NULL
    FOR SHARE`;
  if (!type) throw RationErrors.animalTypeInvalid();
  return type;
}

export interface LockedRation {
  id: string;
  farmId: string;
  animalTypeId: string;
  archivedAt: Date | null;
}

/** Owned ration (archived or not) locked for this transaction; else 404. */
export async function lockOwnedRation(
  tx: Tx,
  ownerId: string,
  rationId: string,
  mode: 'UPDATE' | 'SHARE',
): Promise<LockedRation> {
  const [ration] = await tx.$queryRaw<LockedRation[]>`
    SELECT r.id, r.farm_id AS "farmId", r.animal_type_id AS "animalTypeId",
           r.archived_at AS "archivedAt"
    FROM rations r JOIN farms f ON f.id = r.farm_id
    WHERE r.id = ${rationId}::uuid AND f.owner_id = ${ownerId}::uuid
    FOR ${Prisma.raw(mode === 'UPDATE' ? 'UPDATE' : 'SHARE')} OF r`;
  if (!ration) throw Errors.notFound();
  return ration;
}

/**
 * The most recent issue (created_at desc, id desc) of each ration, in ONE
 * query for any number of rations: DISTINCT ON reads at most one row per
 * ration from the (ration_id, created_at) index. (Prisma's nested
 * `take: 1` would load every issue of every ration and cut in memory.)
 */
export async function lastIssuesOf(
  db: Tx | PrismaService,
  rationIds: readonly string[],
): Promise<Map<string, RationLastIssue>> {
  if (rationIds.length === 0) return new Map();
  const rows = await db.$queryRaw<
    Array<RationLastIssue & { rationId: string }>
  >`
    SELECT DISTINCT ON (ri.ration_id)
           ri.ration_id AS "rationId", ri.id, ri.created_at AS "createdAt",
           ri.days
    FROM ration_issues ri
    WHERE ri.ration_id IN (${Prisma.join(
      rationIds.map((id) => Prisma.sql`${id}::uuid`),
    )})
    ORDER BY ri.ration_id, ri.created_at DESC, ri.id DESC`;
  return new Map(
    rows.map(({ rationId, id, createdAt, days }) => [
      rationId,
      { id, createdAt, days },
    ]),
  );
}

/**
 * Of `ids`, the FEED items of `farmId` that are not archived, locked FOR
 * SHARE (in id order, so concurrent lockers cannot deadlock) until commit:
 * none of them can be archived while a ration starts using it.
 */
export async function lockUsableFeedItems(
  tx: Tx,
  farmId: string,
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT i.id FROM inventory_items i
    WHERE i.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      AND i.farm_id = ${farmId}::uuid
      AND i.category = 'FEED'
      AND i.archived_at IS NULL
    ORDER BY i.id
    FOR SHARE`;
  return new Set(rows.map((row) => row.id));
}
