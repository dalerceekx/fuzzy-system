import { Injectable } from '@nestjs/common';
import { AuditAction } from '../audit/audit-actions.js';
import { AuditService } from '../audit/audit.service.js';
import { Errors } from '../common/errors/app.exception.js';
import type { RationAnimalType } from '../generated/prisma/client.js';
import {
  AnimalSex,
  RationProfile,
  Species,
} from '../generated/prisma/enums.js';
import {
  isUniqueViolation,
  PrismaService,
  type Tx,
} from '../prisma/prisma.service.js';
import type {
  CreateRationAnimalTypeDto,
  ListRationAnimalTypesQueryDto,
} from './dto/animal-type.dto.js';
import { lockActiveFarm, lockOwnedFarm } from './rations-db.js';
import { RationErrors } from './rations.errors.js';
import {
  toAnimalTypeResponse,
  type RationAnimalTypeResponse,
} from './rations.presenter.js';

/** Every farm's default categories, in listing order. */
export const DEFAULT_ANIMAL_TYPES = [
  {
    profile: RationProfile.BULL,
    name: 'Buqa',
    species: Species.CATTLE,
    sex: AnimalSex.MALE,
  },
  {
    profile: RationProfile.COW,
    name: 'Sigir',
    species: Species.CATTLE,
    sex: AnimalSex.FEMALE,
  },
  {
    profile: RationProfile.RAM,
    name: 'Qo‘chqor',
    species: Species.SHEEP,
    sex: AnimalSex.MALE,
  },
  {
    // Named "Sovliq" until migration 20261019010000_rename_ewe_default.
    profile: RationProfile.EWE,
    name: 'Qo‘y',
    species: Species.SHEEP,
    sex: AnimalSex.FEMALE,
  },
] as const;

const DEFAULT_ORDER = new Map<RationProfile, number>(
  DEFAULT_ANIMAL_TYPES.map((type, index) => [type.profile, index]),
);

/** Defaults first (in DEFAULT_ANIMAL_TYPES order), then custom types as given. */
function listingOrder(types: RationAnimalType[]): RationAnimalType[] {
  const defaults = types
    .filter((type) => type.isDefault)
    .sort(
      (a, b) =>
        (DEFAULT_ORDER.get(a.profile) ?? 0) -
        (DEFAULT_ORDER.get(b.profile) ?? 0),
    );
  return [...defaults, ...types.filter((type) => !type.isDefault)];
}

@Injectable()
export class RationAnimalTypesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The farm's types, defaults first; the defaults are created on the first
   * listing of an active farm (an archived farm is listed as it is).
   */
  async list(
    ownerId: string,
    query: ListRationAnimalTypesQueryDto,
  ): Promise<RationAnimalTypeResponse[]> {
    const types = await this.prisma.$transaction(async (tx) => {
      const farm = await lockOwnedFarm(tx, ownerId, query.farmId);
      if (!farm.archivedAt) await this.ensureDefaults(tx, farm.id);
      return tx.rationAnimalType.findMany({
        where: {
          farmId: farm.id,
          ...(query.includeArchived ? {} : { archivedAt: null }),
        },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
      });
    });
    return listingOrder(types).map(toAnimalTypeResponse);
  }

  async create(
    ownerId: string,
    dto: CreateRationAnimalTypeDto,
  ): Promise<RationAnimalTypeResponse> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const farmId = await lockActiveFarm(tx, ownerId, dto.farmId);
        // A custom type can never take a default's name (or its slot).
        await this.ensureDefaults(tx, farmId);
        const type = await tx.rationAnimalType.create({
          data: {
            farmId,
            name: dto.name,
            species: dto.species,
            profile: dto.profile ?? RationProfile.OTHER,
            sex: dto.sex ?? null,
            isDefault: false,
          },
        });
        const response = toAnimalTypeResponse(type);
        await this.audit.record(
          {
            action: AuditAction.RATION_ANIMAL_TYPE_CREATED,
            resourceType: 'ration_animal_type',
            resourceId: type.id,
            newValue: response,
          },
          tx,
        );
        return response;
      });
    } catch (err) {
      // Partial unique index on (farm_id, lower(name)) of non-archived types.
      if (isUniqueViolation(err)) throw RationErrors.animalTypeExists();
      throw err;
    }
  }

  /** Soft delete of a custom type that no active ration uses. */
  async archive(
    ownerId: string,
    id: string,
  ): Promise<RationAnimalTypeResponse> {
    return this.prisma.$transaction(async (tx) => {
      // FOR UPDATE: ration create/patch lock the type FOR SHARE, so no
      // ration can start using it between the check below and the update.
      const [row] = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT t.id FROM ration_animal_types t
        JOIN farms f ON f.id = t.farm_id
        WHERE t.id = ${id}::uuid AND f.owner_id = ${ownerId}::uuid
        FOR UPDATE OF t`;
      if (!row) throw Errors.notFound();
      const current = await tx.rationAnimalType.findUniqueOrThrow({
        where: { id: row.id },
      });
      if (current.isDefault) throw RationErrors.animalTypeDefault();
      if (current.archivedAt) throw RationErrors.animalTypeArchived();
      const rations = await tx.ration.count({
        where: { animalTypeId: current.id, archivedAt: null },
      });
      if (rations > 0) throw RationErrors.animalTypeInUse(rations);

      const archivedAt = new Date();
      const type = await tx.rationAnimalType.update({
        where: { id: current.id },
        data: { archivedAt },
      });
      await this.audit.record(
        {
          action: AuditAction.RATION_ANIMAL_TYPE_ARCHIVED,
          resourceType: 'ration_animal_type',
          resourceId: type.id,
          oldValue: { archivedAt: null },
          newValue: { archivedAt },
        },
        tx,
      );
      return toAnimalTypeResponse(type);
    });
  }

  /**
   * INSERT … ON CONFLICT DO NOTHING of the four defaults: concurrent first
   * listings queue on the partial unique index, so nothing is duplicated.
   * The count keeps the usual call read-only.
   */
  private async ensureDefaults(tx: Tx, farmId: string): Promise<void> {
    const present = await tx.rationAnimalType.count({
      where: { farmId, isDefault: true },
    });
    if (present >= DEFAULT_ANIMAL_TYPES.length) return;
    await tx.rationAnimalType.createMany({
      data: DEFAULT_ANIMAL_TYPES.map((type) => ({
        ...type,
        farmId,
        isDefault: true,
      })),
      skipDuplicates: true,
    });
  }
}
