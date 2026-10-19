import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { DiseaseAnimal } from '../generated/prisma/enums.js';
import { DISEASE_ANIMALS_V1 } from './disease-animals.js';
import {
  DISEASE_SOURCE_FILE,
  DISEASE_SOURCE_KEY,
  DiseaseSeedError,
  defaultDiseaseSource,
  describeSeedResult,
  planDiseaseSource,
  readDiseaseSourceFile,
} from './disease-seed.js';
import { parseDiseaseSource } from './disease-source.parser.js';

const { CATTLE, CALF, SHEEP, LAMB } = DiseaseAnimal;

describe('the shipped source file', () => {
  it('is the user’s text byte for byte (sha256 pinned)', () => {
    const { checksum, text } = readDiseaseSourceFile();
    expect(checksum).toBe(
      'fe619dd8e4229db0887341d0ffa3f5e557cc1310168ab7b3fb4499acdc6ad9fa',
    );
    expect(
      createHash('sha256')
        .update(readFileSync(DISEASE_SOURCE_FILE))
        .digest('hex'),
    ).toBe(checksum);
    expect(text.split('\n')).toHaveLength(153); // 152 lines + final newline
  });

  it('is served under the v1 key with its animals table', () => {
    const input = defaultDiseaseSource();
    expect(input.key).toBe(DISEASE_SOURCE_KEY);
    expect(input.key).toBe('kasalliklar-v1');
    expect(input.animals).toBe(DISEASE_ANIMALS_V1);
  });
});

describe('DISEASE_ANIMALS_V1 (explicit table, not parsed)', () => {
  const diseases = parseDiseaseSource(readDiseaseSourceFile().text).diseases;

  it('is exactly the contract table', () => {
    const animals = Object.fromEntries(
      Object.entries(DISEASE_ANIMALS_V1).map(([n, e]) => [n, e.animals]),
    );
    expect(animals).toEqual({
      1: [CATTLE],
      2: [CATTLE],
      3: [CATTLE, SHEEP],
      4: [CATTLE, SHEEP],
      5: [CATTLE],
      6: [CATTLE, SHEEP],
      7: [CATTLE, SHEEP],
      8: [CATTLE, CALF, SHEEP, LAMB],
      9: [CALF, LAMB],
      10: [CATTLE, SHEEP],
      11: [CATTLE, CALF, SHEEP],
      12: [CATTLE, SHEEP],
      13: [CATTLE, SHEEP],
      14: [CATTLE, CALF, SHEEP, LAMB],
      15: [CATTLE, SHEEP],
      16: [CALF, LAMB],
      17: [CATTLE, CALF, SHEEP],
      18: [SHEEP, LAMB],
    });
  });

  it('quotes, for every disease, phrases that really are in its text', () => {
    for (const d of diseases) {
      const entry = DISEASE_ANIMALS_V1[d.number];
      expect(entry.evidence.length).toBeGreaterThan(0);
      for (const phrase of entry.evidence) {
        expect({
          number: d.number,
          found: d.fullText.includes(phrase),
        }).toEqual({ number: d.number, found: true });
      }
    }
  });
});

describe('planDiseaseSource', () => {
  it('plans 4 groups and 18 diseases with their animals', () => {
    const plan = planDiseaseSource(defaultDiseaseSource());
    expect(plan.parsed.groups).toHaveLength(4);
    expect(plan.parsed.diseases).toHaveLength(18);
    expect(plan.animals.get(9)).toEqual([CALF, LAMB]);
  });

  it('refuses an animals table that does not match the text', () => {
    const source = defaultDiseaseSource();
    const missing = { ...source.animals } as Record<
      number,
      (typeof source.animals)[number]
    >;
    delete missing[18];
    expect(() => planDiseaseSource({ ...source, animals: missing })).toThrow(
      DiseaseSeedError,
    );
    expect(() =>
      planDiseaseSource({
        ...source,
        animals: { ...source.animals, 19: source.animals[1] },
      }),
    ).toThrow(DiseaseSeedError);
  });

  it('describes what happened', () => {
    expect(
      describeSeedResult({
        status: 'created',
        key: 'kasalliklar-v1',
        groups: 4,
        diseases: 18,
      }),
    ).toBe(
      'Kasalliklar ma’lumotnomasi yuklandi: kasalliklar-v1 (4 bo‘lim, 18 kasallik).',
    );
    expect(
      describeSeedResult({
        status: 'unchanged',
        key: 'kasalliklar-v1',
        groups: 4,
        diseases: 18,
      }),
    ).toContain('o‘zgarishsiz');
  });
});
