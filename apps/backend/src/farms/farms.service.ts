import { Injectable } from '@nestjs/common';
import { Errors } from '../common/errors/app.exception.js';
import {
  buildOrderBy,
  paginated,
  toSkipTake,
  type Paginated,
} from '../common/pagination/index.js';
import type { Prisma } from '../generated/prisma/client.js';
import { isNotFoundError, PrismaService } from '../prisma/prisma.service.js';
import type { CreateFarmDto } from './dto/create-farm.dto.js';
import type { ListFarmsQueryDto } from './dto/list-farms-query.dto.js';
import type { UpdateFarmDto } from './dto/update-farm.dto.js';
import { FARM_SELECT, type FarmView } from './farm.view.js';

const FARM_ORDER_BY = {
  createdAt: (dir: Prisma.SortOrder) => ({ createdAt: dir }),
  name: (dir: Prisma.SortOrder) => ({ name: dir }),
};

const farmArchived = () =>
  Errors.conflict('FARM_ARCHIVED', 'Ferma arxivlangan');

@Injectable()
export class FarmsService {
  constructor(private readonly prisma: PrismaService) {}

  create(ownerId: string, dto: CreateFarmDto): Promise<FarmView> {
    return this.prisma.farm.create({
      data: { ownerId, name: dto.name, region: dto.region ?? null },
      select: FARM_SELECT,
    });
  }

  async list(
    ownerId: string,
    query: ListFarmsQueryDto,
  ): Promise<Paginated<FarmView>> {
    const where: Prisma.FarmWhereInput = {
      ownerId,
      ...(query.includeArchived ? {} : { archivedAt: null }),
    };
    const orderBy = [
      ...buildOrderBy(query.sort, FARM_ORDER_BY, { createdAt: 'desc' }),
      { id: 'asc' }, // stable pagination
    ] as Prisma.FarmOrderByWithRelationInput[];
    const [items, total] = await this.prisma.$transaction([
      this.prisma.farm.findMany({
        where,
        orderBy,
        ...toSkipTake(query),
        select: FARM_SELECT,
      }),
      this.prisma.farm.count({ where }),
    ]);
    return paginated(items, total, query);
  }

  async get(ownerId: string, id: string): Promise<FarmView> {
    const farm = await this.prisma.farm.findFirst({
      where: { id, ownerId },
      select: FARM_SELECT,
    });
    if (!farm) throw Errors.notFound();
    return farm;
  }

  async update(
    ownerId: string,
    id: string,
    dto: UpdateFarmDto,
  ): Promise<FarmView> {
    try {
      // Owner and "not archived" are part of the same atomic UPDATE.
      return await this.prisma.farm.update({
        where: { id, ownerId, archivedAt: null },
        data: { name: dto.name, region: dto.region },
        select: FARM_SELECT,
      });
    } catch (err) {
      if (!isNotFoundError(err)) throw err;
      await this.get(ownerId, id); // 404 when missing or not owned
      throw farmArchived();
    }
  }

  async archive(ownerId: string, id: string): Promise<FarmView> {
    return this.prisma.$transaction(async (tx) => {
      // Row lock: animal creation takes FOR SHARE on the same row, so no
      // animal can be added between the emptiness check and the update.
      const [farm] = await tx.$queryRaw<{ archived_at: Date | null }[]>`
        SELECT archived_at FROM farms
        WHERE id = ${id}::uuid AND owner_id = ${ownerId}::uuid
        FOR UPDATE`;
      if (!farm) throw Errors.notFound();
      if (farm.archived_at) throw farmArchived();

      const [animals, inventoryItems] = await Promise.all([
        tx.animal.count({ where: { farmId: id, archivedAt: null } }),
        tx.inventoryItem.count({ where: { farmId: id, archivedAt: null } }),
      ]);
      if (animals > 0 || inventoryItems > 0) {
        throw Errors.conflict(
          'FARM_NOT_EMPTY',
          'Avval fermadagi hayvonlar va ombor mahsulotlarini arxivlang',
          { animals, inventoryItems },
        );
      }
      return tx.farm.update({
        where: { id },
        data: { archivedAt: new Date() },
        select: FARM_SELECT,
      });
    });
  }
}
