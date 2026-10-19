import { Injectable } from '@nestjs/common';
import {
  paginated,
  toSkipTake,
  type Paginated,
} from '../common/pagination/index.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { Species } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { RecommendationQueryDto } from './dto/recommendation-query.dto.js';
import { FARMER_VISIBLE_VERSION } from './protocols.service.js';
import { likeLiteral } from './vet-db.js';
import { EMERGENCY_ADVICE } from './vet.errors.js';
import {
  toDrugResponse,
  VERSION_INCLUDE,
  type ProtocolDrugResponse,
} from './vet.presenter.js';

export interface Recommendation {
  protocolId: string;
  protocolCode: string;
  species: Species;
  versionId: string;
  version: number;
  title: string;
  condition: string;
  instructions: string;
  approvedAt: Date | null;
  drugs: ProtocolDrugResponse[];
}

export type RecommendationsResponse = Paginated<Recommendation> & {
  emergency: boolean;
  advice: string | null;
  /** Emergency answers: always empty — never any medicine. */
  protocols?: [];
};

@Injectable()
export class RecommendationsService {
  constructor(private readonly prisma: PrismaService) {}

  async recommend(
    query: RecommendationQueryDto,
  ): Promise<RecommendationsResponse> {
    if (query.emergency) {
      // Emergencies are never answered with a medicine: the database is not
      // even queried.
      return {
        emergency: true,
        advice: EMERGENCY_ADVICE,
        protocols: [],
        ...paginated<Recommendation>([], 0, query),
      };
    }

    const where: Prisma.ProtocolVersionWhereInput = {
      ...FARMER_VISIBLE_VERSION,
      isEmergency: false,
      drugs: {
        ...FARMER_VISIBLE_VERSION.drugs,
        some: {},
      },
      protocol: {
        is: {
          archivedAt: null,
          isDemo: false,
          ...(query.species ? { species: query.species } : {}),
        },
      },
      ...(query.condition
        ? {
            condition: {
              contains: likeLiteral(query.condition),
              mode: 'insensitive',
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.protocolVersion.findMany({
        where,
        include: { ...VERSION_INCLUDE, protocol: true },
        orderBy: [{ protocol: { code: 'asc' } }, { id: 'asc' }],
        ...toSkipTake(query),
      }),
      this.prisma.protocolVersion.count({ where }),
    ]);
    const items = rows.map((row): Recommendation => ({
      protocolId: row.protocolId,
      protocolCode: row.protocol.code,
      species: row.protocol.species,
      versionId: row.id,
      version: row.version,
      title: row.title,
      condition: row.condition,
      instructions: row.instructions,
      approvedAt: row.approvedAt,
      drugs: row.drugs.map((drug) => toDrugResponse(drug, false)),
    }));
    return {
      emergency: false,
      advice: null,
      ...paginated(items, total, query),
    };
  }
}
