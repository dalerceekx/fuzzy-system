/**
 * Mock data for "Molim kasal": the backend's source file itself (never a
 * copy), split by the same rules as the API (docs: diseases contract).
 */
import sourceText from '../../../backend/prisma/data/kasalliklar-manba.txt?raw';
import type {
  DiseaseAnimal,
  DiseaseDetails,
  DiseaseGroup,
  DiseaseLineKind,
  DiseaseSource,
} from '@/features/diseases/api/diseases.api';

/** Same explicit table as the API (animals named in each section of the source). */
const ANIMALS: Record<number, DiseaseAnimal[]> = {
  1: ['CATTLE'],
  2: ['CATTLE'],
  3: ['CATTLE', 'SHEEP'],
  4: ['CATTLE', 'SHEEP'],
  5: ['CATTLE'],
  6: ['CATTLE', 'SHEEP'],
  7: ['CATTLE', 'SHEEP'],
  8: ['CATTLE', 'CALF', 'SHEEP', 'LAMB'],
  9: ['CALF', 'LAMB'],
  10: ['CATTLE', 'SHEEP'],
  11: ['CATTLE', 'CALF', 'SHEEP'],
  12: ['CATTLE', 'SHEEP'],
  13: ['CATTLE', 'SHEEP'],
  14: ['CATTLE', 'CALF', 'SHEEP', 'LAMB'],
  15: ['CATTLE', 'SHEEP'],
  16: ['CALF', 'LAMB'],
  17: ['CATTLE', 'CALF', 'SHEEP'],
  18: ['SHEEP', 'LAMB'],
};

export function normalizeSearch(text: string): string {
  return text
    .toLocaleLowerCase('uz')
    .replace(/['‘’ʻʼ`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function kindOf(line: string): DiseaseLineKind {
  if (line.startsWith('Xalq tilida belgilari:')) return 'symptoms';
  if (line.startsWith('Davolash sxemasi')) return 'scheme';
  return line.endsWith(':') ? 'subheading' : 'item';
}

/** "Name (Scientific)" → the last trailing parenthesized group is the scientific name. */
function splitTitle(title: string): { name: string; scientificNames: string | null } {
  if (!title.endsWith(')')) return { name: title, scientificNames: null };
  let depth = 0;
  for (let index = title.length - 1; index >= 0; index -= 1) {
    if (title[index] === ')') depth += 1;
    if (title[index] === '(') depth -= 1;
    if (depth === 0) return { name: title.slice(0, index).trim(), scientificNames: title.slice(index + 1, -1) };
  }
  return { name: title, scientificNames: null };
}

export interface DiseaseCatalog {
  source: DiseaseSource;
  groups: DiseaseGroup[];
  diseases: Array<DiseaseDetails & { searchText: string }>;
}

export function parseDiseaseSource(text: string): DiseaseCatalog {
  const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
  const abbreviations = lines[0] ?? '';
  const groups: DiseaseGroup[] = [];
  const raw: Array<{ number: number; group: DiseaseGroup; lines: DiseaseDetails['lines'] }> = [];
  for (const line of lines.slice(1)) {
    const group = /^(\d)-Bo'lim\. (.*)$/.exec(line);
    if (group) {
      groups.push({ number: Number(group[1]), heading: line, title: group[2] ?? '', diseaseCount: 0 });
      continue;
    }
    const current = groups[groups.length - 1];
    const disease = /^(\d{1,2})\. /.exec(line);
    if (disease && current) {
      current.diseaseCount += 1;
      raw.push({ number: Number(disease[1]), group: current, lines: [{ kind: 'title', text: line }] });
      continue;
    }
    raw[raw.length - 1]?.lines.push({ kind: kindOf(line), text: line });
  }
  const diseases = raw.map(({ number, group, lines: diseaseLines }) => {
    const title = (diseaseLines[0]?.text ?? '').replace(/^\d{1,2}\. /, '');
    const symptomsLine = diseaseLines.find((line) => line.kind === 'symptoms')?.text;
    const symptoms = symptomsLine ? symptomsLine.replace(/^Xalq tilida belgilari:\s*/, '') : null;
    return {
      number,
      groupNumber: group.number,
      title,
      ...splitTitle(title),
      symptoms,
      animals: ANIMALS[number] ?? [],
      status: 'SOURCE_TEXT' as const,
      group: { number: group.number, heading: group.heading, title: group.title },
      lines: diseaseLines,
      fullText: diseaseLines.map((line) => line.text).join('\n'),
      abbreviations,
      searchText: normalizeSearch(`${title} ${symptoms ?? ''}`),
    };
  });
  return {
    source: {
      key: 'kasalliklar-v1',
      abbreviations,
      fullText: lines.join('\n'),
      checksum: 'mock',
      groupCount: groups.length,
      diseaseCount: diseases.length,
    },
    groups,
    diseases,
  };
}

let catalog: DiseaseCatalog | null = null;

export function diseaseCatalog(): DiseaseCatalog {
  catalog ??= parseDiseaseSource(sourceText);
  return catalog;
}
