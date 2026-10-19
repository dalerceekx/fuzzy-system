import type { Prisma } from '../generated/prisma/client.js';

/** Fields returned to the owner (ownerId is implied by the caller). */
export const FARM_SELECT = {
  id: true,
  name: true,
  region: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.FarmSelect;

export type FarmView = Prisma.FarmGetPayload<{ select: typeof FARM_SELECT }>;
