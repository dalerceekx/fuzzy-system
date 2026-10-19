import { HttpException } from '@nestjs/common';
import type { AuthUser } from '../../src/common/auth/auth-user.js';
import { UserRole, UserStatus } from '../../src/generated/prisma/enums.js';
import { MedicinesService } from '../../src/vet/medicines.service.js';
import { ProtocolsService } from '../../src/vet/protocols.service.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import {
  createMedicine,
  createProtocolWithVersion,
  uniqueSuffix,
} from '../utils/factories.js';
import {
  actor,
  approvedMedicine,
  approvedProtocol,
  farmer as createFarmer,
  MEDICINES,
  postTreatment,
  protocolBody,
  PROTOCOLS,
  TREATMENTS,
  versionUrl,
  type Farmer,
} from './support.js';

const STAFF_EDITOR_DENIED = [UserRole.FARMER, UserRole.SUPPORT];
const APPROVER_DENIED = [
  UserRole.FARMER,
  UserRole.SUPPORT,
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
];
const FARMER_ONLY_DENIED = [
  UserRole.VET,
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
  UserRole.SUPPORT,
];

/**
 * Every mutating vet route refuses roles outside its allow-list with 403
 * and leaves the database exactly as it was: no row changed or created and
 * no audit row written.
 */
describe('Vet role denial', () => {
  let testApp: TestApp;
  let owner: Farmer;
  let medicineId: string;
  let protocolId: string;
  let draftVersionId: string;
  let approvedProtocolId: string;
  let treatmentId: string;
  let protocolVersionId: string;
  let resourceIds: string[];

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['vet'] });
    owner = await createFarmer(testApp);
    medicineId = (await createMedicine(testApp.prisma)).id;
    const draft = await createProtocolWithVersion(testApp.prisma);
    protocolId = draft.protocol.id;
    draftVersionId = draft.version.id;
    const approved = await approvedProtocol(testApp);
    approvedProtocolId = approved.protocol.id;
    protocolVersionId = approved.version.id;
    treatmentId = (
      await postTreatment(testApp, owner.auth, {
        animalId: owner.animal.id,
        protocolVersionId,
      }).expect(201)
    ).body.id;
    resourceIds = [
      medicineId,
      protocolId,
      draftVersionId,
      approvedProtocolId,
      protocolVersionId,
      treatmentId,
    ];
  });

  afterAll(async () => {
    await testApp.close();
  });

  /** Everything a denied request could have touched. */
  async function state() {
    const prisma = testApp.prisma;
    return {
      medicine: await prisma.medicine.findUniqueOrThrow({
        where: { id: medicineId },
      }),
      protocols: await prisma.protocol.findMany({
        where: { id: { in: [protocolId, approvedProtocolId] } },
        include: { versions: { include: { drugs: true } } },
        orderBy: { id: 'asc' },
      }),
      treatments: await prisma.treatment.findMany({
        where: { animalId: owner.animal.id },
        include: { doses: true },
      }),
      audit: await prisma.auditLog.count({
        where: { resourceId: { in: resourceIds } },
      }),
    };
  }

  const name = `Rad etilgan ${uniqueSuffix()}`;
  const code = `DENIED-${uniqueSuffix().toUpperCase()}`;

  const routes: Array<
    [
      string,
      UserRole[],
      () => { method: 'post' | 'patch'; url: string; body?: object },
    ]
  > = [
    [
      'POST /vet/medicines',
      STAFF_EDITOR_DENIED,
      () => ({
        method: 'post',
        url: MEDICINES,
        body: {
          name,
          activeIngredient: 'x',
          withdrawalMeatDays: 1,
          withdrawalMilkDays: 1,
        },
      }),
    ],
    [
      'PATCH /vet/medicines/:id',
      STAFF_EDITOR_DENIED,
      () => ({
        method: 'patch',
        url: `${MEDICINES}/${medicineId}`,
        body: { name },
      }),
    ],
    [
      'POST /vet/medicines/:id/approve',
      APPROVER_DENIED,
      () => ({ method: 'post', url: `${MEDICINES}/${medicineId}/approve` }),
    ],
    [
      'POST /vet/medicines/:id/archive',
      STAFF_EDITOR_DENIED,
      () => ({ method: 'post', url: `${MEDICINES}/${medicineId}/archive` }),
    ],
    [
      'POST /vet/protocols',
      STAFF_EDITOR_DENIED,
      () => ({
        method: 'post',
        url: PROTOCOLS,
        body: { ...protocolBody([medicineId]), code },
      }),
    ],
    [
      'PATCH /vet/protocols/:id/versions/:versionId',
      STAFF_EDITOR_DENIED,
      () => ({
        method: 'patch',
        url: versionUrl(protocolId, draftVersionId),
        body: { instructions: 'Ruxsatsiz matn' },
      }),
    ],
    [
      'POST /vet/protocols/:id/versions',
      STAFF_EDITOR_DENIED,
      () => ({
        method: 'post',
        url: `${PROTOCOLS}/${approvedProtocolId}/versions`,
      }),
    ],
    [
      'POST /vet/protocols/:id/versions/:versionId/approve',
      APPROVER_DENIED,
      () => ({
        method: 'post',
        url: `${versionUrl(protocolId, draftVersionId)}/approve`,
      }),
    ],
    [
      'POST /vet/protocols/:id/versions/:versionId/archive',
      STAFF_EDITOR_DENIED,
      () => ({
        method: 'post',
        url: `${versionUrl(approvedProtocolId, protocolVersionId)}/archive`,
      }),
    ],
    [
      'POST /vet/treatments',
      FARMER_ONLY_DENIED,
      () => ({
        method: 'post',
        url: TREATMENTS,
        body: { animalId: owner.animal.id, protocolVersionId },
      }),
    ],
    [
      'POST /vet/treatments/:id/complete',
      FARMER_ONLY_DENIED,
      () => ({ method: 'post', url: `${TREATMENTS}/${treatmentId}/complete` }),
    ],
    [
      'POST /vet/treatments/:id/cancel',
      FARMER_ONLY_DENIED,
      () => ({ method: 'post', url: `${TREATMENTS}/${treatmentId}/cancel` }),
    ],
  ];

  it.each(routes)(
    '%s → 403 for %j, nothing changes',
    async (_, roles, make) => {
      const before = await state();
      for (const role of roles) {
        const who = await actor(testApp, role);
        const { method, url, body } = make();
        const res = await testApp
          .http()
          [method](url)
          .set(who.auth)
          .set('Idempotency-Key', `denied-${uniqueSuffix()}`)
          .send(body ?? {});
        expect([res.status, res.body.code]).toEqual([403, 'FORBIDDEN']);
      }
      expect(await state()).toEqual(before);
      expect(await testApp.prisma.medicine.count({ where: { name } })).toBe(0);
      expect(await testApp.prisma.protocol.count({ where: { code } })).toBe(0);
    },
  );

  /**
   * The guard already rejects a stale role, so the services' in-transaction
   * re-read (lockActor) is exercised by calling them directly with an
   * AuthUser that still claims the old role.
   */
  describe('the services re-read the actor inside the transaction', () => {
    const asUser = (id: string, role: UserRole): AuthUser => ({
      id,
      role,
      sessionId: 'stale-session',
      isDemo: false,
      mfaVerified: true,
    });

    async function statusOf(promise: Promise<unknown>): Promise<number> {
      try {
        await promise;
      } catch (err) {
        if (err instanceof HttpException) return err.getStatus();
        throw err;
      }
      throw new Error('expected the call to be refused');
    }

    it('a VET demoted to FARMER after authentication cannot approve', async () => {
      const formerVet = await actor(testApp, UserRole.VET);
      await testApp.prisma.user.update({
        where: { id: formerVet.user.id },
        data: { role: UserRole.FARMER },
      });
      const stale = asUser(formerVet.user.id, UserRole.VET);
      const medicine = await createMedicine(testApp.prisma);
      const { protocol, version } = await createProtocolWithVersion(
        testApp.prisma,
        { medicineIds: [(await approvedMedicine(testApp)).id] },
      );

      const medicines = testApp.moduleRef.get(MedicinesService, {
        strict: false,
      });
      const protocols = testApp.moduleRef.get(ProtocolsService, {
        strict: false,
      });
      expect(await statusOf(medicines.approve(stale, medicine.id))).toBe(403);
      expect(
        await statusOf(
          protocols.approveVersion(stale, protocol.id, version.id),
        ),
      ).toBe(403);

      expect(
        await testApp.prisma.medicine.findUniqueOrThrow({
          where: { id: medicine.id },
        }),
      ).toMatchObject({ status: 'DRAFT', approvedById: null });
      expect(
        await testApp.prisma.protocolVersion.findUniqueOrThrow({
          where: { id: version.id },
        }),
      ).toMatchObject({ status: 'DRAFT', approvedById: null });
      expect(
        await testApp.prisma.auditLog.count({
          where: { resourceId: { in: [medicine.id, version.id] } },
        }),
      ).toBe(0);
    });

    it('a blocked editor cannot edit or archive', async () => {
      const admin = await actor(testApp, UserRole.ADMIN);
      await testApp.prisma.user.update({
        where: { id: admin.user.id },
        data: { status: UserStatus.BLOCKED, blockedAt: new Date() },
      });
      const stale = asUser(admin.user.id, UserRole.ADMIN);
      const medicine = await createMedicine(testApp.prisma);
      const medicines = testApp.moduleRef.get(MedicinesService, {
        strict: false,
      });
      expect(
        await statusOf(medicines.update(stale, medicine.id, { name: 'x' })),
      ).toBe(403);
      expect(await statusOf(medicines.archive(stale, medicine.id))).toBe(403);
      expect(
        await testApp.prisma.medicine.findUniqueOrThrow({
          where: { id: medicine.id },
        }),
      ).toEqual(medicine);
    });
  });
});
