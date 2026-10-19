import { MedicineStatus, UserRole } from '../../src/generated/prisma/enums.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { createMedicine, uniqueSuffix } from '../utils/factories.js';
import { actor, auditRows, MEDICINES, type Actor } from './support.js';

describe('Vet medicines', () => {
  let testApp: TestApp;
  let vet: Actor;
  let admin: Actor;
  let support: Actor;
  let farmer: Actor;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['vet'] });
    [vet, admin, support, farmer] = await Promise.all([
      actor(testApp, UserRole.VET),
      actor(testApp, UserRole.ADMIN),
      actor(testApp, UserRole.SUPPORT),
      actor(testApp, UserRole.FARMER),
    ]);
  });

  afterAll(async () => {
    await testApp.close();
  });

  const body = (overrides: object = {}) => ({
    name: `Oksitetratsiklin ${uniqueSuffix()}`,
    activeIngredient: 'Oksitetratsiklin',
    form: 'inyeksiya',
    concentration: '20%',
    withdrawalMeatDays: 28,
    withdrawalMilkDays: 7,
    ...overrides,
  });

  it('VET, ADMIN and SUPER_ADMIN create DRAFT medicines (audited)', async () => {
    const superAdmin = await actor(testApp, UserRole.SUPER_ADMIN);
    for (const who of [vet, admin, superAdmin]) {
      const res = await testApp
        .http()
        .post(MEDICINES)
        .set(who.auth)
        .send(body())
        .expect(201);
      expect(res.body).toMatchObject({
        status: 'DRAFT',
        isDemo: false,
        approvedAt: null,
        createdById: who.user.id,
        withdrawalMeatDays: 28,
      });
      const audit = await auditRows(testApp, 'medicine', res.body.id);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: 'medicine.created',
        actorId: who.user.id,
        newValue: expect.objectContaining({ status: 'DRAFT' }),
      });
    }
  });

  it('SUPPORT and FARMER cannot create medicines', async () => {
    for (const who of [support, farmer]) {
      await testApp
        .http()
        .post(MEDICINES)
        .set(who.auth)
        .send(body())
        .expect(403);
    }
  });

  it('a demo staff account only creates demo (never approvable) medicines', async () => {
    const demoApp = await createTestApp({
      features: ['vet'],
      env: { DEMO_ACCOUNTS_ENABLED: 'true' },
    });
    try {
      const demoVet = await actor(demoApp, UserRole.VET, { isDemo: true });
      const res = await demoApp
        .http()
        .post(MEDICINES)
        .set(demoVet.auth)
        .send(body())
        .expect(201);
      expect(res.body.isDemo).toBe(true);
      const approve = await demoApp
        .http()
        .post(`${MEDICINES}/${res.body.id}/approve`)
        .set(demoVet.auth)
        .expect(409);
      expect(approve.body.code).toBe('DEMO_NOT_APPROVABLE');
    } finally {
      await demoApp.close();
    }
  });

  it.each([
    [{ withdrawalMeatDays: '28' }],
    [{ withdrawalMeatDays: -1 }],
    [{ withdrawalMilkDays: 3651 }],
    [{ withdrawalMilkDays: 1.5 }],
    [{ name: '' }],
    [{ name: 'x'.repeat(151) }],
    [{ form: null }],
    [{ status: 'APPROVED' }],
    [{ isDemo: false }],
    [{ approvedById: '00000000-0000-4000-8000-000000000000' }],
  ])('rejects invalid body %o', async (overrides) => {
    await testApp
      .http()
      .post(MEDICINES)
      .set(vet.auth)
      .send(body(overrides))
      .expect(400);
  });

  it('PATCH edits a DRAFT medicine and audits old/new values', async () => {
    const created = await testApp
      .http()
      .post(MEDICINES)
      .set(vet.auth)
      .send(body())
      .expect(201);
    const res = await testApp
      .http()
      .patch(`${MEDICINES}/${created.body.id}`)
      .set(admin.auth)
      .send({ withdrawalMeatDays: 30, form: null })
      .expect(200);
    expect(res.body).toMatchObject({ withdrawalMeatDays: 30, form: null });
    const audit = await auditRows(testApp, 'medicine', created.body.id);
    expect(audit.map((row) => row.action)).toEqual([
      'medicine.created',
      'medicine.updated',
    ]);
    expect(audit[1]).toMatchObject({
      oldValue: expect.objectContaining({ withdrawalMeatDays: 28 }),
      newValue: expect.objectContaining({ withdrawalMeatDays: 30, form: null }),
    });
  });

  it('PATCH with no fields → 400 EMPTY_UPDATE', async () => {
    const medicine = await createMedicine(testApp.prisma);
    const res = await testApp
      .http()
      .patch(`${MEDICINES}/${medicine.id}`)
      .set(vet.auth)
      .send({})
      .expect(400);
    expect(res.body.code).toBe('EMPTY_UPDATE');
  });

  it('VET approves a DRAFT medicine (audited medicine.approved)', async () => {
    const medicine = await createMedicine(testApp.prisma);
    const res = await testApp
      .http()
      .post(`${MEDICINES}/${medicine.id}/approve`)
      .set(vet.auth)
      .expect(200);
    expect(res.body).toMatchObject({
      status: 'APPROVED',
      approvedById: vet.user.id,
      approvedAt: expect.any(String),
    });
    const audit = await auditRows(testApp, 'medicine', medicine.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'medicine.approved',
      actorId: vet.user.id,
      actorRole: 'VET',
      oldValue: { status: 'DRAFT' },
      newValue: expect.objectContaining({ status: 'APPROVED' }),
    });
  });

  it('approving a non-DRAFT medicine → 409 MEDICINE_NOT_DRAFT', async () => {
    for (const status of [MedicineStatus.APPROVED, MedicineStatus.ARCHIVED]) {
      const medicine = await createMedicine(testApp.prisma, { status });
      const res = await testApp
        .http()
        .post(`${MEDICINES}/${medicine.id}/approve`)
        .set(vet.auth)
        .expect(409);
      expect(res.body.code).toBe('MEDICINE_NOT_DRAFT');
    }
  });

  it('archive: DRAFT and APPROVED → ARCHIVED (audited); twice → 409', async () => {
    for (const status of [MedicineStatus.DRAFT, MedicineStatus.APPROVED]) {
      const medicine = await createMedicine(testApp.prisma, { status });
      const res = await testApp
        .http()
        .post(`${MEDICINES}/${medicine.id}/archive`)
        .set(admin.auth)
        .expect(200);
      expect(res.body.status).toBe('ARCHIVED');
      const audit = await auditRows(testApp, 'medicine', medicine.id);
      expect(audit).toHaveLength(1);
      expect(audit[0]).toMatchObject({
        action: 'medicine.archived',
        oldValue: { status },
        newValue: { status: 'ARCHIVED' },
      });
      const again = await testApp
        .http()
        .post(`${MEDICINES}/${medicine.id}/archive`)
        .set(admin.auth)
        .expect(409);
      expect(again.body.code).toBe('MEDICINE_ARCHIVED');
    }
  });

  it('FARMER and SUPPORT cannot archive', async () => {
    const medicine = await createMedicine(testApp.prisma);
    for (const who of [support, farmer]) {
      await testApp
        .http()
        .post(`${MEDICINES}/${medicine.id}/archive`)
        .set(who.auth)
        .expect(403);
    }
  });

  it('unknown ids → 404, malformed ids → 400', async () => {
    const unknown = '5b1c6a52-1f0e-4c39-9b3a-6c1f6f0f2d11';
    await testApp
      .http()
      .patch(`${MEDICINES}/${unknown}`)
      .set(vet.auth)
      .send({ name: 'X' })
      .expect(404);
    await testApp
      .http()
      .post(`${MEDICINES}/${unknown}/approve`)
      .set(vet.auth)
      .expect(404);
    await testApp
      .http()
      .get(`${MEDICINES}/${unknown}`)
      .set(vet.auth)
      .expect(404);
    await testApp
      .http()
      .get(`${MEDICINES}/not-a-uuid`)
      .set(vet.auth)
      .expect(400);
  });

  it('staff see every status; staff-only fields are hidden from farmers', async () => {
    const draft = await createMedicine(testApp.prisma);
    const approved = await createMedicine(testApp.prisma, {
      status: MedicineStatus.APPROVED,
    });
    const staffDraft = await testApp
      .http()
      .get(`${MEDICINES}/${draft.id}`)
      .set(support.auth)
      .expect(200);
    expect(staffDraft.body.status).toBe('DRAFT');

    const farmerView = await testApp
      .http()
      .get(`${MEDICINES}/${approved.id}`)
      .set(farmer.auth)
      .expect(200);
    expect(farmerView.body.status).toBe('APPROVED');
    expect(farmerView.body).not.toHaveProperty('createdById');
    expect(farmerView.body).not.toHaveProperty('approvedById');
  });

  it('list paginates, filters by status and searches by name', async () => {
    const tag = uniqueSuffix();
    const draft = await createMedicine(testApp.prisma, { name: `Q-${tag}-a` });
    const approved = await createMedicine(testApp.prisma, {
      name: `Q-${tag}-b`,
      status: MedicineStatus.APPROVED,
    });
    const all = await testApp
      .http()
      .get(MEDICINES)
      .query({ q: `q-${tag}`, sort: 'name', limit: 10 })
      .set(vet.auth)
      .expect(200);
    expect(all.body).toMatchObject({ page: 1, limit: 10, total: 2 });
    expect(all.body.items.map((m: { id: string }) => m.id)).toEqual([
      draft.id,
      approved.id,
    ]);

    const drafts = await testApp
      .http()
      .get(MEDICINES)
      .query({ q: `q-${tag}`, status: 'DRAFT' })
      .set(vet.auth)
      .expect(200);
    expect(drafts.body.items.map((m: { id: string }) => m.id)).toEqual([
      draft.id,
    ]);

    await testApp
      .http()
      .get(MEDICINES)
      .query({ limit: 101 })
      .set(vet.auth)
      .expect(400);
    await testApp
      .http()
      .get(MEDICINES)
      .query({ sort: 'createdById' })
      .set(vet.auth)
      .expect(400);
  });

  it('anonymous callers get 401', async () => {
    await testApp.http().get(MEDICINES).expect(401);
    await testApp.http().post(MEDICINES).send(body()).expect(401);
  });
});
