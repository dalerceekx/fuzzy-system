import { Injectable } from '@nestjs/common';
import { Errors } from '../common/errors/app.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { DISEASE_SOURCE_KEY } from './disease-seed.js';
import { searchWords } from './disease-source.parser.js';
import type { ListDiseasesQueryDto } from './dto/list-diseases-query.dto.js';
import {
  toDiseaseDetail,
  toDiseaseSummary,
  type DiseaseDetail,
  type DiseaseGroupResponse,
  type DiseaseSourceResponse,
  type DiseaseSummary,
} from './diseases.presenter.js';

const notLoaded = () =>
  Errors.serviceUnavailable(
    'DISEASES_NOT_LOADED',
    'Kasalliklar ma’lumotnomasi hali yuklanmagan',
  );

/**
 * Read-only access to the disease reference. Everything returned is the
 * source text itself; nothing is derived from symptoms, no dose is computed.
 */
@Injectable()
export class DiseasesService {
  constructor(private readonly prisma: PrismaService) {}

  async groups(): Promise<DiseaseGroupResponse[]> {
    const { id } = await this.source();
    const groups = await this.prisma.diseaseGroup.findMany({
      where: { sourceId: id },
      orderBy: { number: 'asc' },
      include: { _count: { select: { diseases: true } } },
    });
    return groups.map((group) => ({
      number: group.number,
      heading: group.heading,
      title: group.title,
      diseaseCount: group._count.diseases,
    }));
  }

  /**
   * Animal and group filter in the database; `q` words are matched as plain
   * substrings of search_text (no LIKE pattern, so "%" or "_" are literal).
   * The reference has a fixed, small number of rows.
   */
  async list(query: ListDiseasesQueryDto): Promise<DiseaseSummary[]> {
    const { id } = await this.source();
    const rows = await this.prisma.disease.findMany({
      where: {
        sourceId: id,
        ...(query.animal ? { animals: { has: query.animal } } : {}),
        ...(query.groupNumber ? { group: { number: query.groupNumber } } : {}),
      },
      orderBy: { number: 'asc' },
      include: { group: { select: { number: true } } },
    });
    const words = searchWords(query.q ?? '');
    return rows
      .filter((row) => words.every((word) => row.searchText.includes(word)))
      .map(toDiseaseSummary);
  }

  async get(number: number): Promise<DiseaseDetail> {
    const source = await this.source();
    // Outside INT4 cannot exist (and would fail the query): plain 404.
    if (!Number.isSafeInteger(number) || number < 1 || number > 2 ** 31 - 1) {
      throw Errors.notFound();
    }
    const row = await this.prisma.disease.findUnique({
      where: { sourceId_number: { sourceId: source.id, number } },
      include: { group: true },
    });
    if (!row) throw Errors.notFound();
    return toDiseaseDetail(row, source.abbreviations);
  }

  async sourceText(): Promise<DiseaseSourceResponse> {
    const source = await this.source();
    const counts = await this.prisma.diseaseSource.findUniqueOrThrow({
      where: { id: source.id },
      select: { _count: { select: { groups: true, diseases: true } } },
    });
    return {
      key: source.key,
      abbreviations: source.abbreviations,
      fullText: source.fullText,
      checksum: source.checksum,
      groupCount: counts._count.groups,
      diseaseCount: counts._count.diseases,
    };
  }

  private async source() {
    const source = await this.prisma.diseaseSource.findUnique({
      where: { key: DISEASE_SOURCE_KEY },
    });
    if (!source) throw notLoaded();
    return source;
  }
}
