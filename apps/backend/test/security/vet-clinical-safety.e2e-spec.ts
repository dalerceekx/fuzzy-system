import { addDays } from '../../src/common/time.js';
import {
  MedicineStatus,
  ProtocolVersionStatus,
  UserRole,
} from '../../src/generated/prisma/enums.js';
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
  dayFromToday,
  farmer as createFarmer,
  medicineItem,
  MEDICINES,
  postTreatment,
  protocolBody,
  PROTOCOLS,
  RECOMMENDATIONS,
  today,
  treatmentCount,
  TREATMENTS,
  versionUrl,
  type Actor,
  type Farmer,
} from '../vet/support.js';

/**
 * Clinical safety of the veterinary module: farmers only ever see approved
 * content, only a VET approves, approved content is immutable, emergencies
 * never yield medicines, stock that expires during the course is refused,
 * and a started treatment is a frozen snapshot.
 */
describe('Security: veterinary clinical safety', () => {
  let testApp: TestApp;
  let vet: Actor;
  let farmer: Farmer;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['vet'] });
    vet = await actor(testApp, UserRole.VET);
    farmer = await createFarmer(testApp);
  });

  afterAll(async () => {
    await testApp.close();
  });

  const get = (who: Actor, url: string) =>
    testApp.http().get(url).set(who.auth);

  describe('farmers only see approved content', () => {
    it('DRAFT and ARCHIVED medicines are 404 and absent from lists', async () => {
      const tag = uniqueSuffix();
      const [draft, archived, approved] = await Promise.all([
        createMedicine(testApp.prisma, { name: `Vis-${tag}-draft` }),
        createMedicine(testApp.prisma, {
          name: `Vis-${tag}-archived`,
          status: MedicineStatus.ARCHIVED,
        }),
        createMedicine(testApp.prisma, {
          name: `Vis-${tag}-approved`,
          status: MedicineStatus.APPROVED,
        }),
      ]);
      for (const hidden of [draft, archived]) {
        await get(farmer, `${MEDICINES}/${hidden.id}`).expect(404);
      }
      await get(farmer, `${MEDICINES}/${approved.id}`).expect(200);

      for (const status of [undefined, 'DRAFT', 'ARCHIVED']) {
        const res = await testApp
          .http()
          .get(MEDICINES)
          .query({ q: `vis-${tag}`, ...(status ? { status } : {}) })
          .set(farmer.auth)
          .expect(200);
        expect(res.body.items.map((m: { id: string }) => m.id)).toEqual(
          status ? [] : [approved.id],
        );
      }
      // Staff see all three.
      const staff = await testApp
        .http()
        .get(MEDICINES)
        .query({ q: `vis-${tag}` })
        .set(vet.auth)
        .expect(200);
      expect(staff.body.total).toBe(3);
    });

    it('draft-only protocols are invisible; superseded and draft content never leaks', async () => {
      const draftOnly = await createProtocolWithVersion(testApp.prisma, {
        title: `Draft-only ${uniqueSuffix()}`,
      });
      await get(farmer, `${PROTOCOLS}/${draftOnly.protocol.id}`).expect(404);
      await get(
        farmer,
        versionUrl(draftOnly.protocol.id, draftOnly.version.id),
      ).expect(404);
      const list = await testApp
        .http()
        .get(PROTOCOLS)
        .query({ q: draftOnly.protocol.code })
        .set(farmer.auth)
        .expect(200);
      expect(list.body).toMatchObject({ items: [], total: 0 });

      // v1 approved → v2 approved (v1 superseded) → v3 draft.
      const oldTitle = `Old-${uniqueSuffix()}`;
      const { protocol, version: v1 } = await approvedProtocol(testApp, {
        title: oldTitle,
      });
      const v2 = await testApp
        .http()
        .post(`${PROTOCOLS}/${protocol.id}/versions`)
        .set(vet.auth)
        .expect(201);
      const newTitle = `New-${uniqueSuffix()}`;
      await testApp
        .http()
        .patch(versionUrl(protocol.id, v2.body.id))
        .set(vet.auth)
        .send({ title: newTitle })
        .expect(200);
      await testApp
        .http()
        .post(`${versionUrl(protocol.id, v2.body.id)}/approve`)
        .set(vet.auth)
        .expect(200);
      const v3 = await testApp
        .http()
        .post(`${PROTOCOLS}/${protocol.id}/versions`)
        .set(vet.auth)
        .expect(201);
      const draftTitle = `Draft-${uniqueSuffix()}`;
      await testApp
        .http()
        .patch(versionUrl(protocol.id, v3.body.id))
        .set(vet.auth)
        .send({ title: draftTitle })
        .expect(200);

      const view = await get(farmer, `${PROTOCOLS}/${protocol.id}`).expect(200);
      expect(view.body.approvedVersion).toMatchObject({
        id: v2.body.id,
        title: newTitle,
      });
      const listed = await testApp
        .http()
        .get(PROTOCOLS)
        .query({ q: protocol.code })
        .set(farmer.auth)
        .expect(200);
      for (const body of [view.body, listed.body]) {
        const json = JSON.stringify(body);
        expect(json).not.toContain(oldTitle);
        expect(json).not.toContain(draftTitle);
        expect(json).not.toContain(v1.id);
        expect(json).not.toContain(v3.body.id);
      }
      await get(farmer, versionUrl(protocol.id, v1.id)).expect(404);
      await get(farmer, versionUrl(protocol.id, v3.body.id)).expect(404);
      await get(farmer, versionUrl(protocol.id, v2.body.id)).expect(200);
    });

    it('an approved protocol whose medicine was archived disappears for farmers', async () => {
      const { protocol, medicineIds } = await approvedProtocol(testApp);
      await get(farmer, `${PROTOCOLS}/${protocol.id}`).expect(200);
      await testApp
        .http()
        .post(`${MEDICINES}/${medicineIds[0]}/archive`)
        .set(vet.auth)
        .expect(200);
      await get(farmer, `${PROTOCOLS}/${protocol.id}`).expect(404);
    });
  });

  describe('only a VET approves', () => {
    it('ADMIN, SUPER_ADMIN, SUPPORT and FARMER approving → 403, status unchanged', async () => {
      const medicine = await createMedicine(testApp.prisma);
      const { protocol, version } = await createProtocolWithVersion(
        testApp.prisma,
      );
      for (const role of [
        UserRole.ADMIN,
        UserRole.SUPER_ADMIN,
        UserRole.SUPPORT,
        UserRole.FARMER,
      ]) {
        const who = await actor(testApp, role);
        await testApp
          .http()
          .post(`${MEDICINES}/${medicine.id}/approve`)
          .set(who.auth)
          .expect(403);
        await testApp
          .http()
          .post(`${versionUrl(protocol.id, version.id)}/approve`)
          .set(who.auth)
          .expect(403);
      }
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
          where: {
            resourceId: { in: [medicine.id, version.id] },
            action: { in: ['medicine.approved', 'protocol.version.approved'] },
          },
        }),
      ).toBe(0);
    });

    it('a VET demoted after login can no longer approve (role read from the DB)', async () => {
      const formerVet = await actor(testApp, UserRole.VET);
      await testApp.prisma.user.update({
        where: { id: formerVet.user.id },
        data: { role: UserRole.FARMER },
      });
      const medicine = await createMedicine(testApp.prisma);
      await testApp
        .http()
        .post(`${MEDICINES}/${medicine.id}/approve`)
        .set(formerVet.auth)
        .expect(403);
      expect(
        (
          await testApp.prisma.medicine.findUniqueOrThrow({
            where: { id: medicine.id },
          })
        ).status,
      ).toBe('DRAFT');
    });

    it('the database refuses approvals by a non-VET even if the API is bypassed', async () => {
      const admin = await actor(testApp, UserRole.ADMIN);
      const medicine = await createMedicine(testApp.prisma);
      await expect(
        testApp.prisma.medicine.update({
          where: { id: medicine.id },
          data: {
            status: MedicineStatus.APPROVED,
            approvedById: admin.user.id,
            approvedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
      const { version } = await createProtocolWithVersion(testApp.prisma);
      await expect(
        testApp.prisma.protocolVersion.update({
          where: { id: version.id },
          data: {
            status: ProtocolVersionStatus.APPROVED,
            approvedById: admin.user.id,
            approvedAt: new Date(),
          },
        }),
      ).rejects.toThrow();
    });
  });

  describe('approved content is immutable', () => {
    it('PATCH of an approved protocol version → 409 PROTOCOL_IMMUTABLE, content unchanged', async () => {
      const { protocol, version } = await approvedProtocol(testApp);
      const snapshot = () =>
        testApp.prisma.protocolVersion.findUniqueOrThrow({
          where: { id: version.id },
          include: { drugs: true },
        });
      const before = await snapshot();
      const other = await approvedMedicine(testApp);
      for (const patch of [
        { title: 'O‘zgartirilgan' },
        { isEmergency: true },
        {
          drugs: [
            {
              medicineId: other.id,
              dosePerKg: '9',
              doseUnit: 'ML',
              route: 'IV',
              frequencyPerDay: 3,
              durationDays: 9,
            },
          ],
        },
      ]) {
        const res = await testApp
          .http()
          .patch(versionUrl(protocol.id, version.id))
          .set(vet.auth)
          .send(patch)
          .expect(409);
        expect(res.body).toMatchObject({
          code: 'PROTOCOL_IMMUTABLE',
          message:
            'Tasdiqlangan protokolni o‘zgartirib bo‘lmaydi — yangi versiya yarating',
        });
      }
      expect(await snapshot()).toEqual(before);
    });

    it('PATCH of an approved medicine → 409 MEDICINE_IMMUTABLE, content unchanged', async () => {
      const medicine = await approvedMedicine(testApp);
      const res = await testApp
        .http()
        .patch(`${MEDICINES}/${medicine.id}`)
        .set(vet.auth)
        .send({ withdrawalMeatDays: 0, withdrawalMilkDays: 0 })
        .expect(409);
      expect(res.body.code).toBe('MEDICINE_IMMUTABLE');
      expect(
        await testApp.prisma.medicine.findUniqueOrThrow({
          where: { id: medicine.id },
        }),
      ).toEqual(medicine);
    });

    it('a change goes through a new version that supersedes the old one', async () => {
      const { protocol, version: v1 } = await approvedProtocol(testApp);
      const v2 = await testApp
        .http()
        .post(`${PROTOCOLS}/${protocol.id}/versions`)
        .set(vet.auth)
        .expect(201);
      const drug = v2.body.drugs[0];
      await testApp
        .http()
        .patch(versionUrl(protocol.id, v2.body.id))
        .set(vet.auth)
        .send({
          drugs: [
            {
              medicineId: drug.medicineId,
              dosePerKg: '0.3',
              doseUnit: drug.doseUnit,
              route: drug.route,
              frequencyPerDay: drug.frequencyPerDay,
              durationDays: drug.durationDays,
            },
          ],
        })
        .expect(200);
      // Still the old content for farmers until a VET approves.
      let view = await get(farmer, `${PROTOCOLS}/${protocol.id}`).expect(200);
      expect(view.body.approvedVersion).toMatchObject({
        id: v1.id,
        drugs: [{ dosePerKg: '0.2000' }],
      });

      await testApp
        .http()
        .post(`${versionUrl(protocol.id, v2.body.id)}/approve`)
        .set(vet.auth)
        .expect(200);
      view = await get(farmer, `${PROTOCOLS}/${protocol.id}`).expect(200);
      expect(view.body.approvedVersion).toMatchObject({
        id: v2.body.id,
        version: 2,
        drugs: [{ dosePerKg: '0.3000' }],
      });
      const v1Row = await testApp.prisma.protocolVersion.findUniqueOrThrow({
        where: { id: v1.id },
        include: { drugs: true },
      });
      expect(v1Row.status).toBe('SUPERSEDED');
      expect(v1Row.drugs[0].dosePerKg.toFixed(4)).toBe('0.2000');
      // A superseded version is just as immutable.
      await testApp
        .http()
        .patch(versionUrl(protocol.id, v1.id))
        .set(vet.auth)
        .send({ title: 'x' })
        .expect(409);
    });
  });

  describe('demo clinical data is never approved', () => {
    it('demo medicines and protocols → 409 DEMO_NOT_APPROVABLE, and the DB refuses too', async () => {
      const medicine = await createMedicine(testApp.prisma, { isDemo: true });
      const res = await testApp
        .http()
        .post(`${MEDICINES}/${medicine.id}/approve`)
        .set(vet.auth)
        .expect(409);
      expect(res.body.code).toBe('DEMO_NOT_APPROVABLE');

      const approvedReal = await approvedMedicine(testApp);
      const { protocol, version } = await createProtocolWithVersion(
        testApp.prisma,
        { isDemo: true, medicineIds: [approvedReal.id] },
      );
      const protocolRes = await testApp
        .http()
        .post(`${versionUrl(protocol.id, version.id)}/approve`)
        .set(vet.auth)
        .expect(409);
      expect(protocolRes.body.code).toBe('DEMO_NOT_APPROVABLE');

      expect(
        (
          await testApp.prisma.medicine.findUniqueOrThrow({
            where: { id: medicine.id },
          })
        ).status,
      ).toBe('DRAFT');
      expect(
        (
          await testApp.prisma.protocolVersion.findUniqueOrThrow({
            where: { id: version.id },
          })
        ).status,
      ).toBe('DRAFT');

      // Bypassing the API: the database still refuses.
      for (const update of [
        testApp.prisma.medicine.update({
          where: { id: medicine.id },
          data: {
            status: MedicineStatus.APPROVED,
            approvedById: vet.user.id,
            approvedAt: new Date(),
          },
        }),
        testApp.prisma.protocolVersion.update({
          where: { id: version.id },
          data: {
            status: ProtocolVersionStatus.APPROVED,
            approvedById: vet.user.id,
            approvedAt: new Date(),
          },
        }),
      ]) {
        await expect(update).rejects.toThrow();
      }
    });
  });

  describe('demo and real clinical content never mix', () => {
    let demoApp: TestApp;
    let demoVet: Actor;
    let demoSuperAdmin: Actor;
    let realVet: Actor;

    beforeAll(async () => {
      demoApp = await createTestApp({
        features: ['vet'],
        env: { DEMO_ACCOUNTS_ENABLED: 'true' },
      });
      [demoVet, demoSuperAdmin, realVet] = await Promise.all([
        actor(demoApp, UserRole.VET, { isDemo: true }),
        actor(demoApp, UserRole.SUPER_ADMIN, { isDemo: true }),
        actor(demoApp, UserRole.VET),
      ]);
    });

    afterAll(async () => {
      await demoApp.close();
    });

    const send = (
      who: Actor,
      method: 'post' | 'patch',
      url: string,
      body: object = {},
    ) => demoApp.http()[method](url).set(who.auth).send(body);

    const snapshot = async (medicineIds: string[], protocolIds: string[]) => ({
      medicines: await demoApp.prisma.medicine.findMany({
        where: { id: { in: medicineIds } },
        orderBy: { id: 'asc' },
      }),
      protocols: await demoApp.prisma.protocol.findMany({
        where: { id: { in: protocolIds } },
        include: { versions: { include: { drugs: true } } },
        orderBy: { id: 'asc' },
      }),
    });

    it('demo staff cannot edit, archive or version real content (404, unchanged)', async () => {
      const realDraftMedicine = await createMedicine(demoApp.prisma);
      const realApprovedMedicine = await approvedMedicine(demoApp);
      const real = await approvedProtocol(demoApp);
      const realDraft = await createProtocolWithVersion(demoApp.prisma, {
        medicineIds: [realApprovedMedicine.id],
      });
      const medicineIds = [realDraftMedicine.id, realApprovedMedicine.id];
      const protocolIds = [real.protocol.id, realDraft.protocol.id];
      const before = await snapshot(medicineIds, protocolIds);

      const attempts: Array<[Actor, 'post' | 'patch', string, object?]> = [
        [
          demoVet,
          'patch',
          `${MEDICINES}/${realDraftMedicine.id}`,
          { name: 'DEMO' },
        ],
        [
          demoSuperAdmin,
          'post',
          `${MEDICINES}/${realApprovedMedicine.id}/archive`,
        ],
        [
          demoVet,
          'patch',
          versionUrl(realDraft.protocol.id, realDraft.version.id),
          { instructions: 'DEMO TEXT injected' },
        ],
        [
          demoSuperAdmin,
          'post',
          `${versionUrl(real.protocol.id, real.version.id)}/archive`,
        ],
        [demoVet, 'post', `${PROTOCOLS}/${real.protocol.id}/versions`],
      ];
      for (const [who, method, url, body] of attempts) {
        const res = await send(who, method, url, body);
        expect([url, res.status]).toEqual([url, 404]);
      }
      // Approval stays refused too, as before.
      const approve = await send(
        demoVet,
        'post',
        `${MEDICINES}/${realDraftMedicine.id}/approve`,
      );
      expect([approve.status, approve.body.code]).toEqual([
        409,
        'DEMO_NOT_APPROVABLE',
      ]);

      expect(await snapshot(medicineIds, protocolIds)).toEqual(before);
      expect(
        await demoApp.prisma.auditLog.count({
          where: {
            resourceId: {
              in: [
                ...medicineIds,
                ...protocolIds,
                real.version.id,
                realDraft.version.id,
              ],
            },
          },
        }),
      ).toBe(0);
      // Real staff are not blocked by a demo draft.
      await send(
        realVet,
        'post',
        `${PROTOCOLS}/${real.protocol.id}/versions`,
      ).expect(201);
    });

    it('real staff cannot edit or archive demo content (404, unchanged)', async () => {
      const demoMedicine = await createMedicine(demoApp.prisma, {
        isDemo: true,
      });
      const demo = await createProtocolWithVersion(demoApp.prisma, {
        isDemo: true,
        medicineIds: [demoMedicine.id],
      });
      const before = await snapshot([demoMedicine.id], [demo.protocol.id]);
      for (const [method, url, body] of [
        ['patch', `${MEDICINES}/${demoMedicine.id}`, { name: 'REAL' }],
        ['post', `${MEDICINES}/${demoMedicine.id}/archive`, {}],
        [
          'patch',
          versionUrl(demo.protocol.id, demo.version.id),
          { title: 'REAL' },
        ],
        [
          'post',
          `${versionUrl(demo.protocol.id, demo.version.id)}/archive`,
          {},
        ],
      ] as const) {
        const res = await send(realVet, method, url, body);
        expect([url, res.status]).toEqual([url, 404]);
      }
      expect(await snapshot([demoMedicine.id], [demo.protocol.id])).toEqual(
        before,
      );
    });

    it('protocols only reference medicines of their own demo scope', async () => {
      const realMedicine = await approvedMedicine(demoApp);
      const demoMedicine = await createMedicine(demoApp.prisma, {
        isDemo: true,
      });
      const cases: Array<[Actor, string]> = [
        [demoVet, realMedicine.id],
        [realVet, demoMedicine.id],
      ];
      for (const [who, medicineId] of cases) {
        const body = protocolBody([medicineId]);
        const res = await send(who, 'post', PROTOCOLS, body);
        expect([res.status, res.body.code]).toEqual([
          422,
          'MEDICINE_UNAVAILABLE',
        ]);
        expect(
          await demoApp.prisma.protocol.count({ where: { code: body.code } }),
        ).toBe(0);
      }

      // Swapping a demo medicine into a real draft is refused as well.
      const realDraft = await createProtocolWithVersion(demoApp.prisma, {
        medicineIds: [realMedicine.id],
      });
      const patch = await send(
        realVet,
        'patch',
        versionUrl(realDraft.protocol.id, realDraft.version.id),
        { drugs: protocolBody([demoMedicine.id]).version.drugs },
      );
      expect([patch.status, patch.body.code]).toEqual([
        422,
        'MEDICINE_UNAVAILABLE',
      ]);
      expect(
        await demoApp.prisma.protocolDrug.findMany({
          where: { protocolVersionId: realDraft.version.id },
          select: { medicineId: true },
        }),
      ).toEqual([{ medicineId: realMedicine.id }]);
    });
  });

  describe('emergencies never yield medicines', () => {
    it('emergency recommendations contain no medicines', async () => {
      const condition = `shok-${uniqueSuffix()}`;
      await approvedProtocol(testApp, { condition });
      await approvedProtocol(testApp, { condition, isEmergency: true });

      const emergency = await testApp
        .http()
        .get(RECOMMENDATIONS)
        .query({ condition, emergency: 'true' })
        .set(farmer.auth)
        .expect(200);
      expect(emergency.body).toMatchObject({
        emergency: true,
        protocols: [],
        items: [],
        total: 0,
      });
      expect(emergency.body.advice).toContain('veterinar');
      expect(JSON.stringify(emergency.body)).not.toContain('medicine');

      // The approved emergency protocol is never a (non-emergency) recommendation.
      const normal = await testApp
        .http()
        .get(RECOMMENDATIONS)
        .query({ condition })
        .set(farmer.auth)
        .expect(200);
      expect(normal.body.total).toBe(1);
      expect(
        normal.body.items.every(
          (item: { drugs: unknown[] }) => item.drugs.length > 0,
        ),
      ).toBe(true);
    });

    it('farmers see an approved emergency protocol without its medicines', async () => {
      const { protocol, version } = await approvedProtocol(testApp, {
        isEmergency: true,
      });
      for (const url of [
        `${PROTOCOLS}/${protocol.id}`,
        versionUrl(protocol.id, version.id),
      ]) {
        const res = await get(farmer, url).expect(200);
        const shown = res.body.approvedVersion ?? res.body;
        expect(shown).toMatchObject({ isEmergency: true, drugs: [] });
        expect(shown.emergencyAdvice).toContain('veterinar');
      }
    });

    it('a treatment from an emergency protocol → 422 EMERGENCY_REQUIRES_VET, nothing created', async () => {
      const { version } = await approvedProtocol(testApp, {
        isEmergency: true,
      });
      const before = await treatmentCount(testApp, farmer.animal.id);
      const res = await postTreatment(testApp, farmer.auth, {
        animalId: farmer.animal.id,
        protocolVersionId: version.id,
      }).expect(422);
      expect(res.body.code).toBe('EMERGENCY_REQUIRES_VET');
      expect(await treatmentCount(testApp, farmer.animal.id)).toBe(before);
    });
  });

  describe('stock usability', () => {
    it('an expired item → 422 MEDICINE_EXPIRED, nothing created', async () => {
      const { version, medicineIds } = await approvedProtocol(testApp);
      const item = await medicineItem(testApp, farmer.farm.id, medicineIds[0], {
        expiresOn: dayFromToday(-1),
      });
      const before = await treatmentCount(testApp, farmer.animal.id);
      const res = await postTreatment(testApp, farmer.auth, {
        animalId: farmer.animal.id,
        protocolVersionId: version.id,
        items: [{ medicineId: medicineIds[0], inventoryItemId: item.id }],
      }).expect(422);
      expect(res.body.code).toBe('MEDICINE_EXPIRED');
      expect(await treatmentCount(testApp, farmer.animal.id)).toBe(before);
    });

    it('an item expiring before the last treatment day → 422 MEDICINE_EXPIRED', async () => {
      const { version, medicineIds } = await approvedProtocol(testApp);
      const item = await medicineItem(testApp, farmer.farm.id, medicineIds[0], {
        expiresOn: dayFromToday(1), // the 3-day course ends on day +2
      });
      const res = await postTreatment(testApp, farmer.auth, {
        animalId: farmer.animal.id,
        protocolVersionId: version.id,
        items: [{ medicineId: medicineIds[0], inventoryItemId: item.id }],
      }).expect(422);
      expect(res.body.code).toBe('MEDICINE_EXPIRED');
    });

    it('an opened item past its after-opening shelf life → 422 MEDICINE_OPENED_EXPIRED', async () => {
      const { version, medicineIds } = await approvedProtocol(testApp);
      const item = await medicineItem(testApp, farmer.farm.id, medicineIds[0], {
        openedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
        useWithinDaysAfterOpening: 7,
      });
      const before = await treatmentCount(testApp, farmer.animal.id);
      const res = await postTreatment(testApp, farmer.auth, {
        animalId: farmer.animal.id,
        protocolVersionId: version.id,
        items: [{ medicineId: medicineIds[0], inventoryItemId: item.id }],
      }).expect(422);
      expect(res.body.code).toBe('MEDICINE_OPENED_EXPIRED');
      expect(await treatmentCount(testApp, farmer.animal.id)).toBe(before);
    });
  });

  it('withdrawal dates: the latest drug end + its withdrawal period (Tashkent dates)', async () => {
    const medicine = await approvedMedicine(testApp, {
      withdrawalMeatDays: 14,
      withdrawalMilkDays: 5,
    });
    const { version } = await approvedProtocol(testApp, {
      medicineIds: [medicine.id],
    });
    const res = await postTreatment(testApp, farmer.auth, {
      animalId: farmer.animal.id,
      protocolVersionId: version.id,
    }).expect(201);
    const lastDay = addDays(today(), 2);
    expect(res.body).toMatchObject({
      endsOn: lastDay,
      withdrawalMeatUntil: addDays(lastDay, 14),
      withdrawalMilkUntil: addDays(lastDay, 5),
    });
    const row = await testApp.prisma.treatment.findUniqueOrThrow({
      where: { id: res.body.id },
    });
    expect(row.withdrawalMeatUntil.toISOString().slice(0, 10)).toBe(
      addDays(lastDay, 14),
    );
    expect(row.withdrawalMilkUntil.toISOString().slice(0, 10)).toBe(
      addDays(lastDay, 5),
    );
  });

  it('the snapshot survives animal weight changes and a newly approved protocol version', async () => {
    const owner = await createFarmer(testApp);
    const { protocol, version } = await approvedProtocol(testApp);
    const started = await postTreatment(testApp, owner.auth, {
      animalId: owner.animal.id,
      protocolVersionId: version.id,
    }).expect(201);
    expect(started.body.doses[0].singleDose).toBe('90.0000');

    await testApp.prisma.animal.update({
      where: { id: owner.animal.id },
      data: { weightKg: '600.00' },
    });
    const v2 = await testApp
      .http()
      .post(`${PROTOCOLS}/${protocol.id}/versions`)
      .set(vet.auth)
      .expect(201);
    const drug = v2.body.drugs[0];
    await testApp
      .http()
      .patch(versionUrl(protocol.id, v2.body.id))
      .set(vet.auth)
      .send({
        title: 'Yangi doza',
        drugs: [
          {
            medicineId: drug.medicineId,
            dosePerKg: '1',
            doseUnit: drug.doseUnit,
            route: drug.route,
            frequencyPerDay: 2,
            durationDays: 10,
          },
        ],
      })
      .expect(200);
    await testApp
      .http()
      .post(`${versionUrl(protocol.id, v2.body.id)}/approve`)
      .set(vet.auth)
      .expect(200);

    const after = await testApp
      .http()
      .get(`${TREATMENTS}/${started.body.id}`)
      .set(owner.auth)
      .expect(200);
    expect(after.body).toEqual(started.body);
    expect(after.body).toMatchObject({
      animalWeightKg: '450.00',
      protocolVersionId: version.id,
      protocolSnapshot: {
        protocol: { versionId: version.id, title: version.title },
        animal: { weightKg: '450.00' },
        drugs: [
          { dosePerKg: '0.2000', singleDose: '90.0000', durationDays: 3 },
        ],
      },
    });

    // A new treatment uses the new version and the new weight.
    const next = await postTreatment(testApp, owner.auth, {
      animalId: owner.animal.id,
      protocolVersionId: v2.body.id,
    }).expect(201);
    expect(next.body.doses[0].singleDose).toBe('600.0000');
    // …and the superseded version can no longer start treatments.
    const stale = await postTreatment(testApp, owner.auth, {
      animalId: owner.animal.id,
      protocolVersionId: version.id,
    }).expect(422);
    expect(stale.body.code).toBe('PROTOCOL_NOT_APPROVED');
  });

  it('treatment snapshots and dose rows are immutable in the database', async () => {
    const { version } = await approvedProtocol(testApp);
    const res = await postTreatment(testApp, farmer.auth, {
      animalId: farmer.animal.id,
      protocolVersionId: version.id,
    }).expect(201);
    await expect(
      testApp.prisma.treatment.update({
        where: { id: res.body.id },
        data: { animalWeightKg: '1.00' },
      }),
    ).rejects.toThrow();
    await expect(
      testApp.prisma.treatmentDose.updateMany({
        where: { treatmentId: res.body.id },
        data: { singleDose: '1' },
      }),
    ).rejects.toThrow();
  });
});
