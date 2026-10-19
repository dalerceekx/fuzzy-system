// Pure parser of the "Molim kasal" source text (prisma/data/*.txt). It only
// splits the text into its own lines and labels them: every `text` it
// returns is an original line, verbatim — nothing is reworded, shortened,
// translated or derived (see the "nothing lost" invariant in the spec).

export type DiseaseLineKind =
  'title' | 'symptoms' | 'scheme' | 'subheading' | 'item';

export interface DiseaseLine {
  kind: DiseaseLineKind;
  /** The exact source line. */
  text: string;
}

export interface ParsedDiseaseGroup {
  number: number;
  /** The exact heading line. */
  heading: string;
  /** The heading without its "N-Bo'lim. " prefix. */
  title: string;
}

export interface ParsedDisease {
  number: number;
  groupNumber: number;
  /** Title line without its "N. " prefix. */
  title: string;
  name: string;
  scientificNames: string | null;
  symptoms: string | null;
  /** One entry per source line, in order (the first is the title line). */
  lines: DiseaseLine[];
  /** `lines` joined with "\n". */
  fullText: string;
}

export interface ParsedDiseaseSource {
  /** Line 1, verbatim ("Qisqartmalar: …"). */
  abbreviations: string;
  groups: ParsedDiseaseGroup[];
  diseases: ParsedDisease[];
}

/** A text the parser cannot read without guessing. Fix the text, not this. */
export class DiseaseSourceFormatError extends Error {
  override name = 'DiseaseSourceFormatError';
}

const ABBREVIATIONS_PREFIX = 'Qisqartmalar:';
const GROUP_LINE = /^(\d)-Bo'lim\. /;
const DISEASE_LINE = /^(\d{1,2})\. /;
const SYMPTOMS_PREFIX = 'Xalq tilida belgilari:';
const SCHEME_PREFIX = 'Davolash sxemasi';

/** The file's lines (one final newline allowed; CR is refused, not fixed). */
export function sourceLines(text: string): string[] {
  if (text.includes('\r')) {
    throw new DiseaseSourceFormatError(
      'Manba matnida CR (\\r) bor: faqat LF qator tugashi qo‘llab-quvvatlanadi',
    );
  }
  const body = text.endsWith('\n') ? text.slice(0, -1) : text;
  return body.split('\n');
}

/** Kind of a non-first line of a disease. */
export function lineKind(text: string): Exclude<DiseaseLineKind, 'title'> {
  if (text.startsWith(SYMPTOMS_PREFIX)) return 'symptoms';
  if (text.startsWith(SCHEME_PREFIX)) return 'scheme';
  if (text.endsWith(':')) return 'subheading';
  return 'item';
}

/**
 * "Name (Scientific names)" → both parts: when the title ends with ")", the
 * content of that LAST parenthesized group (nesting respected) and the
 * trimmed text before it. Otherwise the whole title is the name.
 */
export function splitTitle(title: string): {
  name: string;
  scientificNames: string | null;
} {
  if (!title.endsWith(')')) return { name: title, scientificNames: null };
  let depth = 0;
  for (let i = title.length - 1; i >= 0; i -= 1) {
    if (title[i] === ')') depth += 1;
    else if (title[i] === '(') {
      depth -= 1;
      if (depth === 0) {
        const name = title.slice(0, i).trim();
        if (!name) break;
        return { name, scientificNames: title.slice(i + 1, -1) };
      }
    }
  }
  return { name: title, scientificNames: null };
}

/**
 * Structure (validated, never guessed): line 1 is the abbreviations line;
 * "N-Bo'lim. " lines start groups 1, 2, …; "N. " lines start diseases
 * 1, 2, … in order; every other line belongs to the disease above it.
 */
export function parseDiseaseSource(text: string): ParsedDiseaseSource {
  const lines = sourceLines(text);
  const [abbreviations, ...rest] = lines;
  if (!abbreviations?.startsWith(ABBREVIATIONS_PREFIX)) {
    throw new DiseaseSourceFormatError(
      `1-qator "${ABBREVIATIONS_PREFIX}" bilan boshlanishi kerak`,
    );
  }

  const groups: ParsedDiseaseGroup[] = [];
  const blocks: Array<{
    number: number;
    groupNumber: number;
    lines: string[];
  }> = [];
  rest.forEach((line, index) => {
    const lineNumber = index + 2;
    const group = GROUP_LINE.exec(line);
    if (group) {
      const number = Number(group[1]);
      if (number !== groups.length + 1) {
        throw new DiseaseSourceFormatError(
          `${lineNumber}-qator: ${groups.length + 1}-bo‘lim kutilgan, ${number}-bo‘lim keldi`,
        );
      }
      groups.push({
        number,
        heading: line,
        title: line.slice(group[0].length),
      });
      blocks.push({ number: 0, groupNumber: number, lines: [] });
      return;
    }
    const disease = DISEASE_LINE.exec(line);
    if (disease) {
      if (groups.length === 0) {
        throw new DiseaseSourceFormatError(
          `${lineNumber}-qator: kasallik birorta bo‘limdan oldin kelgan`,
        );
      }
      const number = Number(disease[1]);
      const expected = blocks.filter((b) => b.number > 0).length + 1;
      if (number !== expected) {
        throw new DiseaseSourceFormatError(
          `${lineNumber}-qator: ${expected}-kasallik kutilgan, ${number}-kasallik keldi`,
        );
      }
      blocks.push({ number, groupNumber: groups.length, lines: [line] });
      return;
    }
    const current = blocks.at(-1);
    if (!current || current.number === 0) {
      throw new DiseaseSourceFormatError(
        `${lineNumber}-qator hech qaysi kasallikka tegishli emas`,
      );
    }
    current.lines.push(line);
  });

  const diseases = blocks
    .filter((block) => block.number > 0)
    .map((block) => toDisease(block.number, block.groupNumber, block.lines));
  return { abbreviations, groups, diseases };
}

function toDisease(
  number: number,
  groupNumber: number,
  texts: string[],
): ParsedDisease {
  const [titleLine, ...body] = texts;
  const title = titleLine.slice(DISEASE_LINE.exec(titleLine)![0].length);
  const lines: DiseaseLine[] = [
    { kind: 'title', text: titleLine },
    ...body.map((text) => ({ kind: lineKind(text), text })),
  ];
  const symptomLines = lines.filter((line) => line.kind === 'symptoms');
  if (symptomLines.length > 1) {
    throw new DiseaseSourceFormatError(
      `${number}-kasallikda "${SYMPTOMS_PREFIX}" qatori bir nechta`,
    );
  }
  const symptoms =
    symptomLines.length === 1
      ? symptomLines[0].text.slice(SYMPTOMS_PREFIX.length).replace(/^ /, '')
      : null;
  return {
    number,
    groupNumber,
    title,
    ...splitTitle(title),
    symptoms,
    lines,
    fullText: lines.map((line) => line.text).join('\n'),
  };
}

// Apostrophe variants written in Uzbek Latin: ' ‘ ’ ʻ ʼ `
const APOSTROPHES = /['‘’ʻʼ`]/g;

/**
 * Search form of a text: NFC, lower case (uz), apostrophe variants removed,
 * whitespace collapsed. Applied identically to the stored search_text and to
 * the query, so "gadir" and "G‘ADIR" both find "g'adir-budur".
 */
export function normalizeSearchText(value: string): string {
  return value
    .normalize('NFC')
    .toLocaleLowerCase('uz')
    .replace(APOSTROPHES, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The only text search matches: the disease's title and symptoms line. */
export function searchTextOf(
  disease: Pick<ParsedDisease, 'title' | 'symptoms'>,
): string {
  return normalizeSearchText(
    disease.symptoms === null
      ? disease.title
      : `${disease.title} ${disease.symptoms}`,
  );
}

/** Query words; every one must be a substring of search_text. */
export function searchWords(query: string): string[] {
  const normalized = normalizeSearchText(query);
  return normalized ? normalized.split(' ') : [];
}
