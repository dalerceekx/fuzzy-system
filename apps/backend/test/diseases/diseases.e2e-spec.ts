import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import {
  DISEASE_SOURCE_FILE,
  DISEASE_SOURCE_KEY,
  DiseaseSeedError,
  defaultDiseaseSource,
  planDiseaseSource,
  seedDiseaseSource,
  writeDiseaseSource,
} from '../../src/diseases/disease-seed.js';
import { UserRole } from '../../src/generated/prisma/enums.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { loginAs, type LoggedIn } from '../utils/auth.js';
import { createUser, uniqueSuffix } from '../utils/factories.js';

const DISEASES = '/api/v1/diseases';
const BACKEND_ROOT = join(import.meta.dirname, '..', '..');
const TSX_CLI = createRequire(import.meta.url).resolve('tsx/cli');
const FILE_TEXT = readFileSync(DISEASE_SOURCE_FILE, 'utf8');

interface Summary {
  number: number;
  groupNumber: number;
  title: string;
  name: string;
  scientificNames: string | null;
  symptoms: string | null;
  animals: string[];
  status: string;
}

interface Detail extends Summary {
  group: { number: number; heading: string; title: string };
  lines: Array<{ kind: string; text: string }>;
  fullText: string;
  abbreviations: string;
}

/** The seed CLI from source, with the test environment. */
function runSeedCli(): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [TSX_CLI, 'src/cli/seed-diseases.ts'],
      { cwd: BACKEND_ROOT, env: { ...process.env }, stdio: 'pipe' },
    );
    let out = '';
    child.stdout.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (out += chunk.toString()));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, out }));
  });
}

describe('Disease reference ("Molim kasal")', () => {
  let testApp: TestApp;
  let farmer: LoggedIn;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['diseases'] });
    // Reference data: created on the first run, a no-op afterwards.
    await seedDiseaseSource(testApp.prisma, defaultDiseaseSource());
    const { user } = await createUser(testApp.prisma, {
      role: UserRole.FARMER,
    });
    farmer = await loginAs(testApp, user);
  });

  afterAll(async () => {
    await testApp.close();
  });

  const get = (path: string, query: Record<string, string> = {}) =>
    testApp
      .http()
      .get(`${DISEASES}${path}`)
      .query(query)
      .set(farmer.authHeader);
  const numbers = async (query: Record<string, string>) => {
    const res = await get('', query).expect(200);
    return (res.body as Summary[]).map((d) => d.number);
  };

  describe('access', () => {
    it.each([
      UserRole.FARMER,
      UserRole.VET,
      UserRole.SUPPORT,
      UserRole.ADMIN,
      UserRole.SUPER_ADMIN,
    ])('%s can read every route', async (role) => {
      const { user } = await createUser(testApp.prisma, { role });
      const auth = await loginAs(testApp, user);
      for (const path of ['', '/groups', '/source', '/1']) {
        await testApp
          .http()
          .get(`${DISEASES}${path}`)
          .set(auth.authHeader)
          .expect(200);
      }
    });

    it('anonymous callers get 401', async () => {
      for (const path of ['', '/groups', '/source', '/1']) {
        await testApp.http().get(`${DISEASES}${path}`).expect(401);
      }
    });

    it('is read-only: no write routes exist', async () => {
      for (const method of ['post', 'patch', 'put', 'delete'] as const) {
        const res = await testApp
          .http()
          [method](`${DISEASES}/1`)
          .set(farmer.authHeader)
          .send({});
        expect([404, 405]).toContain(res.status);
      }
    });
  });

  describe('GET /diseases/groups', () => {
    it('lists the 4 groups with their exact headings and counts', async () => {
      const res = await get('/groups').expect(200);
      expect(
        (
          res.body as Array<{
            number: number;
            diseaseCount: number;
            heading: string;
            title: string;
          }>
        ).map((g) => [
          g.number,
          g.diseaseCount,
          g.heading.startsWith(`${g.number}-Bo'lim. `),
        ]),
      ).toEqual([
        [1, 7, true],
        [2, 4, true],
        [3, 4, true],
        [4, 3, true],
      ]);
      expect(res.body[0]).toEqual({
        number: 1,
        heading:
          "1-Bo'lim. Teri, Yelin (Mastit) va Bachadon (Ginekologik) Kasalliklari Sxemalari",
        title:
          'Teri, Yelin (Mastit) va Bachadon (Ginekologik) Kasalliklari Sxemalari',
        diseaseCount: 7,
      });
    });
  });

  describe('GET /diseases', () => {
    it('lists all 18 in order, as summaries', async () => {
      const res = await get('').expect(200);
      expect((res.body as Summary[]).map((d) => d.number)).toEqual(
        Array.from({ length: 18 }, (_, i) => i + 1),
      );
      expect(res.body[0]).toEqual({
        number: 1,
        groupNumber: 1,
        title:
          "Qoramollarda teridagi g'adir-budur tugunli toshma kasalligi (Nodulyar dermatit)",
        name: "Qoramollarda teridagi g'adir-budur tugunli toshma kasalligi",
        scientificNames: 'Nodulyar dermatit',
        symptoms: expect.stringMatching(/^Molning isitmasi 40°C gacha/),
        animals: ['CATTLE'],
        status: 'SOURCE_TEXT',
      });
      expect(res.body[17]).toMatchObject({
        number: 18,
        groupNumber: 4,
        scientificNames: null,
        symptoms: null,
        animals: ['SHEEP', 'LAMB'],
      });
      expect(
        (res.body as Summary[]).every((d) => d.status === 'SOURCE_TEXT'),
      ).toBe(true);
    });

    it('filters by animal and group, combined with AND', async () => {
      expect(await numbers({ animal: 'CALF' })).toEqual([8, 9, 11, 14, 16, 17]);
      expect(await numbers({ animal: 'LAMB' })).toEqual([8, 9, 14, 16, 18]);
      expect(await numbers({ groupNumber: '2' })).toEqual([8, 9, 10, 11]);
      expect(await numbers({ animal: 'SHEEP', groupNumber: '1' })).toEqual([
        3, 4, 6, 7,
      ]);
      expect(await numbers({ animal: 'CALF', groupNumber: '1' })).toEqual([]);
    });

    it('searches title and symptoms, normalized like search_text', async () => {
      expect(await numbers({ q: 'gadir' })).toEqual([1]);
      expect(await numbers({ q: 'G‘ADIR' })).toEqual([1]);
      expect(await numbers({ q: "  g'adir   BUDUR " })).toEqual([1]);
      expect(await numbers({ q: 'Nodulyar' })).toEqual([1]);
      expect(await numbers({ q: 'mastit' })).toEqual([2, 3]);
      expect(await numbers({ q: 'mastit', animal: 'SHEEP' })).toEqual([3]);
      // Every word must occur; words are substrings ("klinik" is in both
      // "Klinik" and "Subklinik").
      expect(await numbers({ q: 'mastit klinik' })).toEqual([2, 3]);
      expect(await numbers({ q: 'mastit subklinik' })).toEqual([2]);
      expect(await numbers({ q: '' })).toHaveLength(18);
    });

    it('matches only the source text: no synonyms, schemes or patterns', async () => {
      for (const q of [
        'zzzz',
        'Azitronit',
        'dermatitis',
        '%',
        '_',
        'gadir zzzz',
      ]) {
        expect({ q, found: await numbers({ q }) }).toEqual({ q, found: [] });
      }
    });

    it.each<Record<string, string>>([
      { animal: 'DOG' },
      { groupNumber: '5' },
      { groupNumber: '0' },
      { groupNumber: 'abc' },
      { q: 'x'.repeat(101) },
      { diagnosis: 'isitma' },
      { page: '1' },
    ])('rejects %o (400)', async (query) => {
      await get('', query).expect(400);
    });
  });

  describe('GET /diseases/source', () => {
    it('serves the whole file with its checksum and counts', async () => {
      const res = await get('/source').expect(200);
      expect(res.body).toEqual({
        key: DISEASE_SOURCE_KEY,
        abbreviations: FILE_TEXT.split('\n')[0],
        fullText: FILE_TEXT,
        checksum: createHash('sha256')
          .update(readFileSync(DISEASE_SOURCE_FILE))
          .digest('hex'),
        groupCount: 4,
        diseaseCount: 18,
      });
    });
  });

  describe('GET /diseases/:number', () => {
    it('returns every disease 1–18 whose parts reproduce the source', async () => {
      const source = (await get('/source').expect(200)).body as {
        abbreviations: string;
        fullText: string;
      };
      const groups = (await get('/groups').expect(200)).body as Array<{
        number: number;
        heading: string;
      }>;
      const details: Detail[] = [];
      for (let n = 1; n <= 18; n += 1) {
        const res = await get(`/${n}`).expect(200);
        const detail = res.body as Detail;
        expect(detail.number).toBe(n);
        expect(detail.lines.map((l) => l.text).join('\n')).toBe(
          detail.fullText,
        );
        expect(detail.lines[0]).toEqual({
          kind: 'title',
          text: `${n}. ${detail.title}`,
        });
        expect(detail.abbreviations).toBe(source.abbreviations);
        expect(detail.group.number).toBe(detail.groupNumber);
        details.push(detail);
      }
      const rebuilt = [
        source.abbreviations,
        ...groups.flatMap((group) => [
          group.heading,
          ...details
            .filter((d) => d.groupNumber === group.number)
            .map((d) => d.fullText),
        ]),
      ].join('\n');
      expect(rebuilt).toBe(source.fullText.replace(/\n$/, ''));
    });

    it('keeps the line kinds and odd characters as in the source', async () => {
      const first = (await get('/1').expect(200)).body as Detail;
      expect(first.lines.map((l) => l.kind).slice(0, 4)).toEqual([
        'title',
        'symptoms',
        'scheme',
        'subheading',
      ]);
      expect(first.group).toEqual({
        number: 1,
        heading: expect.stringMatching(/^1-Bo'lim\. /),
        title: expect.any(String),
      });
      const sixth = (await get('/6').expect(200)).body as Detail;
      expect(sixth.fullText).toContain('чуқур');
    });

    it('404s for an unknown number and 400s for a non-integer', async () => {
      for (const n of ['19', '0', '-1', '99999999999999']) {
        const res = await get(`/${n}`).expect(404);
        expect(res.body.code).toBe('NOT_FOUND');
      }
      for (const n of ['abc', '1.5']) {
        const res = await get(`/${n}`).expect(400);
        expect(res.body.code).toBe('INVALID_ID');
      }
    });
  });

  describe('seed', () => {
    const counts = async (key: string) => ({
      sources: await testApp.prisma.diseaseSource.count({ where: { key } }),
      groups: await testApp.prisma.diseaseGroup.count({
        where: { source: { key } },
      }),
      diseases: await testApp.prisma.disease.count({
        where: { source: { key } },
      }),
    });

    it('is idempotent: running it again (function and CLI) creates nothing', async () => {
      const again = await seedDiseaseSource(
        testApp.prisma,
        defaultDiseaseSource(),
      );
      expect(again).toEqual({
        status: 'unchanged',
        key: DISEASE_SOURCE_KEY,
        groups: 4,
        diseases: 18,
      });
      const cli = await runSeedCli();
      expect(cli.code).toBe(0);
      expect(cli.out).toContain('o‘zgarishsiz: kasalliklar-v1');
      expect(await counts(DISEASE_SOURCE_KEY)).toEqual({
        sources: 1,
        groups: 4,
        diseases: 18,
      });
    }, 60_000);

    it('fails loudly on a changed text under the same key, writing nothing', async () => {
      const before = await testApp.prisma.diseaseSource.findUniqueOrThrow({
        where: { key: DISEASE_SOURCE_KEY },
      });
      const text = FILE_TEXT.replace('40°C gacha', '41°C gacha');
      const changed = {
        ...defaultDiseaseSource(),
        text,
        checksum: createHash('sha256').update(text).digest('hex'),
      };
      await expect(seedDiseaseSource(testApp.prisma, changed)).rejects.toThrow(
        DiseaseSeedError,
      );
      await expect(seedDiseaseSource(testApp.prisma, changed)).rejects.toThrow(
        /boshqa checksum/,
      );
      expect(
        await testApp.prisma.diseaseSource.findUniqueOrThrow({
          where: { key: DISEASE_SOURCE_KEY },
        }),
      ).toEqual(before);
      expect(await counts(DISEASE_SOURCE_KEY)).toEqual({
        sources: 1,
        groups: 4,
        diseases: 18,
      });
    });

    it('creates a new key in one transaction (rolled back here)', async () => {
      const key = `test-${uniqueSuffix()}`;
      const plan = planDiseaseSource({ ...defaultDiseaseSource(), key });
      const rollback = new Error('rollback');
      await expect(
        testApp.prisma.$transaction(async (tx) => {
          expect(await writeDiseaseSource(tx, plan)).toEqual({
            status: 'created',
            key,
            groups: 4,
            diseases: 18,
          });
          expect((await writeDiseaseSource(tx, plan)).status).toBe('unchanged');
          const first = await tx.disease.findFirstOrThrow({
            where: { source: { key }, number: 1 },
          });
          expect(first).toMatchObject({
            name: "Qoramollarda teridagi g'adir-budur tugunli toshma kasalligi",
            scientificNames: 'Nodulyar dermatit',
            animals: ['CATTLE'],
            status: 'SOURCE_TEXT',
          });
          expect(first.searchText).toContain('gadir-budur');
          throw rollback;
        }),
      ).rejects.toBe(rollback);
      expect(await counts(key)).toEqual({
        sources: 0,
        groups: 0,
        diseases: 0,
      });
    });

    it('stored reference rows are immutable', async () => {
      const where = { source: { key: DISEASE_SOURCE_KEY }, number: 1 };
      await expect(
        testApp.prisma.disease.updateMany({ where, data: { name: 'x' } }),
      ).rejects.toThrow();
      await expect(
        testApp.prisma.disease.deleteMany({ where }),
      ).rejects.toThrow();
      await expect(
        testApp.prisma.diseaseSource.updateMany({
          where: { key: DISEASE_SOURCE_KEY },
          data: { abbreviations: 'x' },
        }),
      ).rejects.toThrow();
      const row = await testApp.prisma.disease.findFirstOrThrow({ where });
      expect(row.name).toBe(
        "Qoramollarda teridagi g'adir-budur tugunli toshma kasalligi",
      );
    });
  });
});
