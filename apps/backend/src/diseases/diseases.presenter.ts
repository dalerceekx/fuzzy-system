import type { Disease, DiseaseGroup } from '../generated/prisma/client.js';
import type {
  DiseaseAnimal,
  DiseaseInfoStatus,
} from '../generated/prisma/enums.js';
import type { DiseaseLine } from './disease-source.parser.js';

/** Every field is source text verbatim (or the explicit animals table). */
export interface DiseaseSummary {
  number: number;
  groupNumber: number;
  title: string;
  name: string;
  scientificNames: string | null;
  symptoms: string | null;
  animals: DiseaseAnimal[];
  /** Always SOURCE_TEXT: "Manba matni — veterinar tasdig‘i talab qilinadi". */
  status: DiseaseInfoStatus;
}

export interface DiseaseDetail extends DiseaseSummary {
  group: { number: number; heading: string; title: string };
  lines: DiseaseLine[];
  fullText: string;
  abbreviations: string;
}

export interface DiseaseGroupResponse {
  number: number;
  heading: string;
  title: string;
  diseaseCount: number;
}

export interface DiseaseSourceResponse {
  key: string;
  abbreviations: string;
  fullText: string;
  checksum: string;
  groupCount: number;
  diseaseCount: number;
}

type SummaryRow = Disease & { group: Pick<DiseaseGroup, 'number'> };

export function toDiseaseSummary(row: SummaryRow): DiseaseSummary {
  return {
    number: row.number,
    groupNumber: row.group.number,
    title: row.title,
    name: row.name,
    scientificNames: row.scientificNames,
    symptoms: row.symptoms,
    animals: row.animals,
    status: row.status,
  };
}

export function toDiseaseDetail(
  row: Disease & { group: DiseaseGroup },
  abbreviations: string,
): DiseaseDetail {
  // Written by the seed only, from the parser's output.
  const lines = row.lines as unknown as DiseaseLine[];
  return {
    ...toDiseaseSummary(row),
    group: {
      number: row.group.number,
      heading: row.group.heading,
      title: row.group.title,
    },
    lines: lines.map((line) => ({ kind: line.kind, text: line.text })),
    fullText: row.fullText,
    abbreviations,
  };
}
