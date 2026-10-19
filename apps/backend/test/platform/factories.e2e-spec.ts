import {
  MedicineStatus,
  ProtocolVersionStatus,
  UserRole,
} from '../../src/generated/prisma/enums.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import {
  createMedicine,
  createProtocolWithVersion,
  createUser,
} from '../utils/factories.js';

// The shared factories must satisfy the DB rules module tests rely on.
describe('Test factories (medicines and protocols)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  async function roleOf(userId: string | null): Promise<UserRole | null> {
    if (!userId) return null;
    const user = await testApp.prisma.user.findUniqueOrThrow({
      where: { id: userId },
    });
    return user.role;
  }

  it('approves as a VET even when the author is not a VET', async () => {
    const { user: admin } = await createUser(testApp.prisma, {
      role: UserRole.ADMIN,
    });
    const medicine = await createMedicine(testApp.prisma, {
      status: MedicineStatus.APPROVED,
      createdById: admin.id,
    });
    expect(medicine.status).toBe(MedicineStatus.APPROVED);
    expect(medicine.createdById).toBe(admin.id);
    expect(await roleOf(medicine.approvedById)).toBe(UserRole.VET);

    const { version, medicineIds } = await createProtocolWithVersion(
      testApp.prisma,
      { approved: true, createdById: admin.id },
    );
    expect(version.status).toBe(ProtocolVersionStatus.APPROVED);
    expect(await roleOf(version.approvedById)).toBe(UserRole.VET);
    expect(medicineIds).toHaveLength(1);
  });

  it('defaults to a fresh VET who both authors and approves', async () => {
    const medicine = await createMedicine(testApp.prisma, {
      status: MedicineStatus.APPROVED,
    });
    expect(medicine.approvedById).toBe(medicine.createdById);
    expect(await roleOf(medicine.approvedById)).toBe(UserRole.VET);
  });

  it('refuses demo + approved with a clear error (the DB forbids it)', async () => {
    await expect(
      createMedicine(testApp.prisma, {
        isDemo: true,
        status: MedicineStatus.APPROVED,
      }),
    ).rejects.toThrow('demo medicines cannot be APPROVED');
    await expect(
      createProtocolWithVersion(testApp.prisma, {
        isDemo: true,
        approved: true,
      }),
    ).rejects.toThrow('demo protocols cannot be approved');
  });
});
