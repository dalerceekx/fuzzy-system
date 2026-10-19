import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../src/generated/prisma/client.js';
import { uniquePhone, uniqueSuffix } from '../utils/factories.js';
import { demoUsersFingerprint, runSeed } from '../infra/seed-runner.js';

// REQUIREMENTS "productionda demo seed bloklanishi": with NODE_ENV=production
// the seed must stop with a clear error before touching the database, even
// when every other demo setting is present and valid.
describe('demo seed in production', () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
    });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function fullDemoEnv(nodeEnv: string): Promise<Record<string, string>> {
    const suffix = uniqueSuffix();
    return {
      NODE_ENV: nodeEnv,
      DEMO_ACCOUNTS_ENABLED: 'true',
      DEMO_PASSWORD: 'Demo-prod-attempt-123',
      DEMO_SUPER_ADMIN_PHONE: await uniquePhone(),
      DEMO_SUPER_ADMIN_EMAIL: `sa-${suffix}@meningfermam.local`,
      DEMO_SUPER_ADMIN_PASSWORD: 'DemoAdmin123!',
      DEMO_FARMER_PHONE: await uniquePhone(),
      DEMO_FARMER_EMAIL: `farmer-${suffix}@meningfermam.local`,
      DEMO_FARMER_PASSWORD: 'DemoFarmer123!',
    };
  }

  it.each(['production', 'staging'])(
    'NODE_ENV=%s → non-zero exit, clear error, nothing written',
    async (nodeEnv) => {
      const env = await fullDemoEnv(nodeEnv);
      const before = await demoUsersFingerprint(prisma);

      const result = await runSeed(env);

      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain('XATO');
      expect(result.stderr).toContain(`NODE_ENV=${nodeEnv}`);
      expect(result.stdout).not.toContain('Demo akkaunt tayyor');
      // Neither the configured accounts nor any other demo row appeared.
      const created = await prisma.user.findMany({
        where: {
          phone: { in: [env.DEMO_SUPER_ADMIN_PHONE, env.DEMO_FARMER_PHONE] },
        },
      });
      expect(created).toEqual([]);
      expect(await demoUsersFingerprint(prisma)).toBe(before);
      // The password is never echoed, not even in the refusal.
      expect(result.stdout + result.stderr).not.toContain(env.DEMO_PASSWORD);
    },
  );

  it('refuses before connecting: an unreachable database is never contacted', async () => {
    const env = await fullDemoEnv('production');
    const result = await runSeed({
      ...env,
      // Would fail with a connection error if the guard ran too late.
      DATABASE_URL: 'postgresql://nobody:nothing@127.0.0.1:1/nowhere',
    });
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/faqat development\/test/);
    expect(result.stderr).not.toMatch(/ma’lumotlar bazasi|ECONNREFUSED/);
  });
});
