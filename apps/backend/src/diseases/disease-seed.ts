import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Prisma, PrismaClient } from '../generated/prisma/client.js';
import {
  DiseaseInfoStatus,
  type DiseaseAnimal,
} from '../generated/prisma/enums.js';
import { isUniqueViolation } from '../prisma/db-errors.js';
import {
  DISEASE_ANIMALS_V1,
  type DiseaseAnimalsEntry,
} from './disease-animals.js';
import {
  parseDiseaseSource,
  searchTextOf,
  type ParsedDiseaseSource,
} from './disease-source.parser.js';

/** The source the API serves. A corrected text gets a NEW key. */
export const DISEASE_SOURCE_KEY = 'kasalliklar-v1';

/**
 * The source file, resolved from this module so it works from src/ (tsx)
 * and dist/ (production image: prisma/data/ is copied next to dist/).
 */
export const DISEASE_SOURCE_FILE = fileURLToPath(
  new URL('../../prisma/data/kasalliklar-manba.txt', import.meta.url),
);

/** A refusal with a message that is safe to print. */
export class DiseaseSeedError extends Error {
  override name = 'DiseaseSeedError';
}

export interface DiseaseSourceFile {
  /** The file content, decoded from strictly valid UTF-8. */
  text: string;
  /** sha256 (hex) of the file's bytes. */
  checksum: string;
}

export function readDiseaseSourceFile(
  path: string = DISEASE_SOURCE_FILE,
): DiseaseSourceFile {
  const bytes = readFileSync(path);
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) {
    throw new DiseaseSeedError(`${path}: UTF-8 bo‘lmagan bayt bor`);
  }
  return { text, checksum: createHash('sha256').update(bytes).digest('hex') };
}

export interface DiseaseSourceInput extends DiseaseSourceFile {
  key: string;
  /** The explicit animals table of this source, by disease number. */
  animals: Readonly<Record<number, DiseaseAnimalsEntry>>;
}

export interface DiseaseSourcePlan {
  key: string;
  checksum: string;
  text: string;
  parsed: ParsedDiseaseSource;
  animals: ReadonlyMap<number, readonly DiseaseAnimal[]>;
}

/** The v1 source as shipped (file + its animals table). */
export function defaultDiseaseSource(
  path: string = DISEASE_SOURCE_FILE,
): DiseaseSourceInput {
  return {
    key: DISEASE_SOURCE_KEY,
    animals: DISEASE_ANIMALS_V1,
    ...readDiseaseSourceFile(path),
  };
}

/**
 * Parses and cross-checks everything before any database work: the animals
 * table must name exactly the parsed disease numbers.
 */
export function planDiseaseSource(
  input: DiseaseSourceInput,
): DiseaseSourcePlan {
  const parsed = parseDiseaseSource(input.text);
  const parsedNumbers = parsed.diseases.map((d) => d.number);
  const tableNumbers = Object.keys(input.animals)
    .map(Number)
    .sort((a, b) => a - b);
  if (parsedNumbers.join(',') !== tableNumbers.join(',')) {
    throw new DiseaseSeedError(
      `Hayvonlar jadvali (${tableNumbers.join(',')}) matndagi kasalliklarga ` +
        `(${parsedNumbers.join(',')}) mos emas`,
    );
  }
  return {
    key: input.key,
    checksum: input.checksum,
    text: input.text,
    parsed,
    animals: new Map(
      parsedNumbers.map((n) => [n, input.animals[n].animals] as const),
    ),
  };
}

export interface DiseaseSeedResult {
  status: 'created' | 'unchanged';
  key: string;
  groups: number;
  diseases: number;
}

/**
 * Writes the source unless its key is already stored: same checksum → no-op
 * ('unchanged'); another checksum → DiseaseSeedError (stored reference data
 * is never overwritten — load a corrected text under a new key).
 */
export async function writeDiseaseSource(
  tx: Prisma.TransactionClient,
  plan: DiseaseSourcePlan,
): Promise<DiseaseSeedResult> {
  const existing = await tx.diseaseSource.findUnique({
    where: { key: plan.key },
    select: {
      checksum: true,
      _count: { select: { groups: true, diseases: true } },
    },
  });
  if (existing) {
    if (existing.checksum !== plan.checksum) {
      throw new DiseaseSeedError(
        `"${plan.key}" manbasi bazada boshqa checksum bilan saqlangan ` +
          `(${existing.checksum}, fayl: ${plan.checksum}). Saqlangan ma’lumot ` +
          'hech qachon ustidan yozilmaydi: tuzatilgan matnni yangi kalit bilan yuklang.',
      );
    }
    return {
      status: 'unchanged',
      key: plan.key,
      groups: existing._count.groups,
      diseases: existing._count.diseases,
    };
  }

  const { parsed } = plan;
  const sourceId = randomUUID();
  await tx.diseaseSource.create({
    data: {
      id: sourceId,
      key: plan.key,
      abbreviations: parsed.abbreviations,
      fullText: plan.text,
      checksum: plan.checksum,
    },
  });
  const groupIds = new Map(parsed.groups.map((g) => [g.number, randomUUID()]));
  await tx.diseaseGroup.createMany({
    data: parsed.groups.map((group) => ({
      id: groupIds.get(group.number)!,
      sourceId,
      number: group.number,
      heading: group.heading,
      title: group.title,
    })),
  });
  await tx.disease.createMany({
    data: parsed.diseases.map((disease) => ({
      sourceId,
      groupId: groupIds.get(disease.groupNumber)!,
      number: disease.number,
      title: disease.title,
      name: disease.name,
      scientificNames: disease.scientificNames,
      symptoms: disease.symptoms,
      animals: [...plan.animals.get(disease.number)!],
      lines: disease.lines.map((line) => ({
        kind: line.kind,
        text: line.text,
      })),
      fullText: disease.fullText,
      searchText: searchTextOf(disease),
      status: DiseaseInfoStatus.SOURCE_TEXT,
    })),
  });
  return {
    status: 'created',
    key: plan.key,
    groups: parsed.groups.length,
    diseases: parsed.diseases.length,
  };
}

/**
 * The disease reference seed (dev seed and `seed-diseases` CLI): parse and
 * check first, then everything in ONE transaction. Idempotent; a concurrent
 * run that inserted the same key first is answered like a re-run.
 */
export async function seedDiseaseSource(
  prisma: PrismaClient,
  input: DiseaseSourceInput,
): Promise<DiseaseSeedResult> {
  const plan = planDiseaseSource(input);
  const run = () =>
    prisma.$transaction((tx) => writeDiseaseSource(tx, plan), {
      timeout: 30_000,
      maxWait: 10_000,
    });
  try {
    return await run();
  } catch (err) {
    if (isUniqueViolation(err)) return run();
    throw err;
  }
}

/** One line for operators: what the seed did. */
export function describeSeedResult(result: DiseaseSeedResult): string {
  const counts = `${result.groups} bo‘lim, ${result.diseases} kasallik`;
  return result.status === 'created'
    ? `Kasalliklar ma’lumotnomasi yuklandi: ${result.key} (${counts}).`
    : `Kasalliklar ma’lumotnomasi allaqachon yuklangan, o‘zgarishsiz: ${result.key} (${counts}).`;
}
