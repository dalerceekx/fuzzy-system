import { Injectable } from '@nestjs/common';
import { AuditAction } from '../audit/audit-actions.js';
import { AuditService } from '../audit/audit.service.js';
import { Errors } from '../common/errors/app.exception.js';
import {
  buildOrderBy,
  paginated,
  toSkipTake,
  type Paginated,
} from '../common/pagination/index.js';
import { dateOnlyToDate, todayInTashkent } from '../common/time.js';
import type { Prisma } from '../generated/prisma/client.js';
import { TreatmentStatus } from '../generated/prisma/enums.js';
import {
  isNotFoundError,
  isUniqueViolation,
  PrismaService,
  type Tx,
} from '../prisma/prisma.service.js';
import {
  activeWithdrawalFrom,
  ANIMAL_SELECT,
  toAnimalView,
  type AnimalDetailView,
  type AnimalView,
} from './animal.view.js';
import type { ArchiveAnimalDto } from './dto/archive-animal.dto.js';
import type { CreateAnimalDto } from './dto/create-animal.dto.js';
import type { ListAnimalsQueryDto } from './dto/list-animals-query.dto.js';
import type { UpdateAnimalDto } from './dto/update-animal.dto.js';

const ANIMAL_ORDER_BY = {
  createdAt: (dir: Prisma.SortOrder) => ({ createdAt: dir }),
  tagNumber: (dir: Prisma.SortOrder) => ({ tagNumber: dir }),
  name: (dir: Prisma.SortOrder) => ({ name: { sort: dir, nulls: 'last' } }),
};

const tagNumberTaken = () =>
  Errors.conflict(
    'TAG_NUMBER_TAKEN',
    'Bu fermada shu birka raqamli faol hayvon allaqachon mavjud',
  );
const animalArchived = () =>
  Errors.conflict('ANIMAL_ARCHIVED', 'Hayvon arxivlangan');

/** Ownership is always part of the query: other farmers' rows are 404. */
const owned = (ownerId: string, id: string): Prisma.AnimalWhereInput => ({
  id,
  farm: { ownerId },
});

const optionalDate = (value: string | null | undefined) =>
  value === undefined
    ? undefined
    : value === null
      ? null
      : dateOnlyToDate(value);

@Injectable()
export class AnimalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(ownerId: string, dto: CreateAnimalDto): Promise<AnimalView> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        // FOR SHARE blocks a concurrent farm archive (FOR UPDATE) until this
        // insert commits, so an archived farm never gains an active animal.
        const [farm] = await tx.$queryRaw<{ archived_at: Date | null }[]>`
          SELECT archived_at FROM farms
          WHERE id = ${dto.farmId}::uuid AND owner_id = ${ownerId}::uuid
          FOR SHARE`;
        if (!farm) throw Errors.notFound();
        if (farm.archived_at) {
          throw Errors.conflict('FARM_ARCHIVED', 'Ferma arxivlangan');
        }
        return tx.animal.create({
          data: {
            farmId: dto.farmId,
            tagNumber: dto.tagNumber,
            species: dto.species,
            sex: dto.sex,
            name: dto.name ?? null,
            birthDate: optionalDate(dto.birthDate),
            weightKg: dto.weightKg ?? null,
            notes: dto.notes || null,
          },
          select: ANIMAL_SELECT,
        });
      });
      return toAnimalView(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw tagNumberTaken();
      throw err;
    }
  }

  async list(
    ownerId: string,
    query: ListAnimalsQueryDto,
  ): Promise<Paginated<AnimalView>> {
    const where: Prisma.AnimalWhereInput = {
      farm: { ownerId },
      ...(query.farmId ? { farmId: query.farmId } : {}),
      ...(query.species ? { species: query.species } : {}),
      ...(query.includeArchived ? {} : { archivedAt: null }),
    };
    const orderBy = [
      ...buildOrderBy(query.sort, ANIMAL_ORDER_BY, { createdAt: 'desc' }),
      { id: 'asc' }, // stable pagination
    ] as Prisma.AnimalOrderByWithRelationInput[];
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.animal.findMany({
        where,
        orderBy,
        ...toSkipTake(query),
        select: ANIMAL_SELECT,
      }),
      this.prisma.animal.count({ where }),
    ]);
    return paginated(rows.map(toAnimalView), total, query);
  }

  async get(ownerId: string, id: string): Promise<AnimalDetailView> {
    const row = await this.prisma.animal.findFirst({
      where: owned(ownerId, id),
      select: ANIMAL_SELECT,
    });
    if (!row) throw Errors.notFound();
    return {
      ...toAnimalView(row),
      activeWithdrawal: await this.activeWithdrawal(this.prisma, id),
    };
  }

  async update(
    ownerId: string,
    id: string,
    dto: UpdateAnimalDto,
  ): Promise<AnimalView> {
    try {
      // Owner and "not archived" are part of the same atomic UPDATE.
      const row = await this.prisma.animal.update({
        where: { id, farm: { ownerId }, archivedAt: null },
        data: {
          tagNumber: dto.tagNumber,
          species: dto.species,
          sex: dto.sex,
          name: dto.name,
          birthDate: optionalDate(dto.birthDate),
          weightKg: dto.weightKg,
          notes: dto.notes === '' ? null : dto.notes,
        },
        select: ANIMAL_SELECT,
      });
      return toAnimalView(row);
    } catch (err) {
      if (isUniqueViolation(err)) throw tagNumberTaken();
      if (!isNotFoundError(err)) throw err;
      throw await this.notFoundOrArchived(ownerId, id);
    }
  }

  async archive(
    ownerId: string,
    id: string,
    dto: ArchiveAnimalDto,
  ): Promise<AnimalView> {
    const row = await this.prisma.$transaction(async (tx) => {
      // Lock the row first so `before` is the real pre-archive state: a
      // concurrent PATCH either commits before this lock or waits for it.
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT a.id FROM animals a
        JOIN farms f ON f.id = a.farm_id
        WHERE a.id = ${id}::uuid AND f.owner_id = ${ownerId}::uuid
        FOR UPDATE OF a`;
      if (!locked) throw Errors.notFound();
      const before = await tx.animal.findUniqueOrThrow({
        where: { id },
        select: ANIMAL_SELECT,
      });
      if (before.archivedAt) throw animalArchived();

      // Archiving records a real-world event (sale, death, slaughter) and is
      // never refused; a running treatment or withdrawal is kept as evidence.
      const [activeWithdrawal, activeTreatments] = await Promise.all([
        this.activeWithdrawal(tx, id),
        tx.treatment.count({
          where: { animalId: id, status: TreatmentStatus.ACTIVE },
        }),
      ]);
      const after = await tx.animal.update({
        where: { id },
        data: { archivedAt: new Date(), archivedReason: dto.reason },
        select: ANIMAL_SELECT,
      });

      await this.audit.record(
        {
          action: AuditAction.ANIMAL_ARCHIVED,
          resourceType: 'animal',
          resourceId: id,
          oldValue: auditSnapshot(before),
          newValue: {
            ...auditSnapshot(after),
            activeWithdrawal,
            activeTreatments,
          },
        },
        tx,
      );
      return after;
    });
    return toAnimalView(row);
  }

  /**
   * Read straight from the treatments table (no dependency on the vet
   * module). Completed treatments still carry withdrawal periods.
   */
  private async activeWithdrawal(client: Tx, animalId: string) {
    const today = todayInTashkent();
    const todayDate = dateOnlyToDate(today);
    const treatments = await client.treatment.findMany({
      where: {
        animalId,
        status: { not: TreatmentStatus.CANCELLED },
        OR: [
          { withdrawalMeatUntil: { gte: todayDate } },
          { withdrawalMilkUntil: { gte: todayDate } },
        ],
      },
      select: { withdrawalMeatUntil: true, withdrawalMilkUntil: true },
    });
    return activeWithdrawalFrom(treatments, today);
  }

  private async notFoundOrArchived(ownerId: string, id: string) {
    const exists = await this.prisma.animal.findFirst({
      where: owned(ownerId, id),
      select: { id: true },
    });
    return exists ? animalArchived() : Errors.notFound();
  }
}

function auditSnapshot(row: {
  farmId: string;
  tagNumber: string;
  archivedAt: Date | null;
  archivedReason: string | null;
}) {
  return {
    farmId: row.farmId,
    tagNumber: row.tagNumber,
    archivedAt: row.archivedAt,
    archivedReason: row.archivedReason,
  };
}
