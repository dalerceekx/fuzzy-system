import { readFileSync } from 'node:fs';
import { DISEASE_SOURCE_FILE } from './disease-seed.js';
import {
  DiseaseSourceFormatError,
  lineKind,
  normalizeSearchText,
  parseDiseaseSource,
  searchTextOf,
  searchWords,
  sourceLines,
  splitTitle,
} from './disease-source.parser.js';

const TEXT = readFileSync(DISEASE_SOURCE_FILE, 'utf8');
const parsed = parseDiseaseSource(TEXT);
const disease = (n: number) => parsed.diseases[n - 1];

describe('parseDiseaseSource (kasalliklar-manba.txt)', () => {
  it('finds 4 groups and 18 diseases, numbered in order', () => {
    expect(parsed.groups.map((g) => g.number)).toEqual([1, 2, 3, 4]);
    expect(parsed.diseases.map((d) => d.number)).toEqual(
      Array.from({ length: 18 }, (_, i) => i + 1),
    );
    expect(parsed.diseases.map((d) => d.groupNumber)).toEqual([
      1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4,
    ]);
  });

  it('nothing lost, nothing added: everything joined is the file', () => {
    const joined = [
      parsed.abbreviations,
      ...parsed.groups.flatMap((group) => [
        group.heading,
        ...parsed.diseases
          .filter((d) => d.groupNumber === group.number)
          .map((d) => d.fullText),
      ]),
    ].join('\n');
    expect(joined).toBe(TEXT.replace(/\n$/, ''));
    // And line by line, in file order.
    const all = [
      parsed.abbreviations,
      ...parsed.groups.flatMap((group) => [
        group.heading,
        ...parsed.diseases
          .filter((d) => d.groupNumber === group.number)
          .flatMap((d) => d.lines.map((line) => line.text)),
      ]),
    ];
    expect(all).toEqual(sourceLines(TEXT));
    expect(all).toHaveLength(152);
  });

  it('keeps the abbreviations line and the group headings verbatim', () => {
    expect(parsed.abbreviations).toBe(sourceLines(TEXT)[0]);
    expect(parsed.abbreviations.startsWith('Qisqartmalar: m/i — ')).toBe(true);
    expect(parsed.groups[0]).toEqual({
      number: 1,
      heading:
        "1-Bo'lim. Teri, Yelin (Mastit) va Bachadon (Ginekologik) Kasalliklari Sxemalari",
      title:
        'Teri, Yelin (Mastit) va Bachadon (Ginekologik) Kasalliklari Sxemalari',
    });
    for (const group of parsed.groups) {
      expect(group.heading).toBe(`${group.number}-Bo'lim. ${group.title}`);
    }
  });

  it('splits #1 into name and scientific names', () => {
    expect(disease(1)).toMatchObject({
      title:
        "Qoramollarda teridagi g'adir-budur tugunli toshma kasalligi (Nodulyar dermatit)",
      name: "Qoramollarda teridagi g'adir-budur tugunli toshma kasalligi",
      scientificNames: 'Nodulyar dermatit',
    });
    expect(disease(1).symptoms).toMatch(/^Molning isitmasi 40°C gacha/);
  });

  it('uses the LAST parenthesized group and leaves the rest of the name', () => {
    expect(disease(16)).toMatchObject({
      name: "Buzoq va qo'zilarda oyoqqa tura olmaslik («Oq mushak kasalligi»), Raxit va Kamqonlik",
      scientificNames: 'Anemiya',
    });
    expect(disease(11).scientificNames).toBe(
      "Yuqumli keratokon'yunktivit va Telyazioz — ko'z qurti",
    );
  });

  it('#18 (yearly sheep calendar) has no scientific names, symptoms or scheme', () => {
    const calendar = disease(18);
    expect(calendar.scientificNames).toBeNull();
    expect(calendar.name).toBe(calendar.title);
    expect(calendar.symptoms).toBeNull();
    expect(calendar.lines.map((l) => l.kind)).toEqual([
      'title',
      'item',
      'item',
      'item',
      'item',
      'item',
      'item',
    ]);
  });

  it('diseases 1–17 have exactly one symptoms and one scheme line', () => {
    for (const d of parsed.diseases.slice(0, 17)) {
      const kinds = d.lines.map((l) => l.kind);
      expect(kinds[0]).toBe('title');
      expect(kinds.filter((k) => k === 'title')).toHaveLength(1);
      expect(kinds.filter((k) => k === 'symptoms')).toHaveLength(1);
      expect(kinds.filter((k) => k === 'scheme')).toHaveLength(1);
      const symptomsLine = d.lines.find((l) => l.kind === 'symptoms')!;
      expect(symptomsLine.text).toBe(`Xalq tilida belgilari: ${d.symptoms}`);
    }
  });

  it('labels every kind of line', () => {
    const kinds = disease(1).lines.map((l) => l.kind);
    expect(kinds).toEqual([
      'title',
      'symptoms',
      'scheme',
      'subheading',
      'item',
      'item',
      'item',
      'item',
      'item',
      'item',
    ]);
    // A scheme line with a season in brackets is still the scheme line.
    expect(disease(13).lines[2]).toEqual({
      kind: 'scheme',
      text: 'Davolash sxemasi (Mart–Aprel va Sentyabr–Oktyabr / Dekabr–Yanvar — bittasi tanlanadi):',
    });
    // Ends with ":" → subheading; a bracketed line → item.
    expect(disease(12).lines.map((l) => l.kind)).toContain('subheading');
    expect(
      disease(12).lines.find((l) => l.text.startsWith('(Anaplazmoz'))?.kind,
    ).toBe('item');
  });

  it('keeps odd characters as they are (the Cyrillic "чуқур" in #6)', () => {
    expect(disease(6).fullText).toContain('Regostenol — чуқур m/i');
  });

  it('every fullText is its lines joined', () => {
    for (const d of parsed.diseases) {
      expect(d.fullText).toBe(d.lines.map((l) => l.text).join('\n'));
      expect(d.lines[0].text).toBe(`${d.number}. ${d.title}`);
    }
  });
});

describe('parseDiseaseSource refuses what it would have to guess', () => {
  const ok = [
    'Qisqartmalar: x',
    "1-Bo'lim. A",
    '1. Bir (Unus)',
    'Xalq tilida belgilari: b',
    'Davolash sxemasi:',
    'c',
  ].join('\n');

  it('parses a minimal source (final newline optional)', () => {
    expect(parseDiseaseSource(ok).diseases).toHaveLength(1);
    expect(parseDiseaseSource(`${ok}\n`)).toEqual(parseDiseaseSource(ok));
  });

  it.each([
    ['CRLF line ends', ok.replace(/\n/g, '\r\n')],
    ['no abbreviations line', ok.split('\n').slice(1).join('\n')],
    ['a disease before any group', ok.replace("1-Bo'lim. A\n", '')],
    ['a disease number gap', `${ok}\n3. Uch`],
    ['a group number gap', `${ok}\n3-Bo'lim. C`],
    ['a line outside any disease', ok.replace("1-Bo'lim. A", "1-Bo'lim. A\nx")],
    ['two symptoms lines', `${ok}\nXalq tilida belgilari: yana`],
  ])('%s', (_label, text) => {
    expect(() => parseDiseaseSource(text)).toThrow(DiseaseSourceFormatError);
  });
});

describe('helpers', () => {
  it('lineKind', () => {
    expect(lineKind('Xalq tilida belgilari: x')).toBe('symptoms');
    expect(lineKind('Davolash sxemasi:')).toBe('scheme');
    expect(lineKind('Davolash sxemasi (bahor):')).toBe('scheme');
    expect(lineKind('Antibiotik (bittasi tanlanadi):')).toBe('subheading');
    expect(lineKind('Fluneks: 2 ml.')).toBe('item');
  });

  it('splitTitle', () => {
    expect(splitTitle('A (B)')).toEqual({ name: 'A', scientificNames: 'B' });
    expect(splitTitle('A (x) b (C (D))')).toEqual({
      name: 'A (x) b',
      scientificNames: 'C (D)',
    });
    expect(splitTitle('A (x) b')).toEqual({
      name: 'A (x) b',
      scientificNames: null,
    });
    expect(splitTitle('(B)')).toEqual({ name: '(B)', scientificNames: null });
    expect(splitTitle('A B)')).toEqual({ name: 'A B)', scientificNames: null });
  });

  it('normalizes like search_text: case, apostrophe variants, spaces', () => {
    expect(normalizeSearchText("  G‘ADIR-budur  Qo'y\tqo’zi ʻaʼ`b ")).toBe(
      'gadir-budur qoy qozi ab',
    );
    expect(searchWords('  G‘ADIR   budur ')).toEqual(['gadir', 'budur']);
    expect(searchWords('   ')).toEqual([]);
  });

  it('search_text is built from the title and the symptoms line only', () => {
    const first = disease(1);
    const text = searchTextOf(first);
    expect(text).toContain('gadir-budur');
    expect(text).toContain('nodulyar dermatit');
    expect(text).toContain('molning isitmasi');
    // Scheme lines (drug names) are not searchable.
    expect(first.fullText).toContain('Azitronit');
    expect(text).not.toContain('azitronit');
    expect(searchTextOf(disease(18))).toBe(
      normalizeSearchText(disease(18).title),
    );
  });
});
