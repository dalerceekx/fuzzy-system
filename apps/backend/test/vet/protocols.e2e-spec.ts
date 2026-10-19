import { MedicineStatus, UserRole } from '../../src/generated/prisma/enums.js';
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
  auditRows,
  protocolBody,
  PROTOCOLS,
  versionUrl,
  type Actor,
} from './support.js';

describe('Vet protocols', () => {
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

  const create = (who: Actor, body: object) =>
    testApp.http().post(PROTOCOLS).set(who.auth).send(body);

  it('creates protocol + version 1 DRAFT with drugs (audited)', async () => {
    const medicine = await approvedMedicine(testApp);
    const body = protocolBody([medicine.id]);
    body.version.drugs[0] = {
      ...body.version.drugs[0],
      maxSingleDose: '100',
    } as (typeof body.version.drugs)[0];
    const res = await create(admin, body).expect(201);
    expect(res.body).toMatchObject({
      code: body.code,
      species: 'CATTLE',
      isDemo: false,
      approvedVersion: null,
    });
    expect(res.body.versions).toHaveLength(1);
    expect(res.body.versions[0]).toMatchObject({
      version: 1,
      status: 'DRAFT',
      title: body.version.title,
      isEmergency: false,
      emergencyAdvice: null,
      drugs: [
        {
          medicineId: medicine.id,
          medicineName: medicine.name,
          dosePerKg: '0.2000',
          maxSingleDose: '100.0000',
          doseUnit: 'ML',
          route: 'IM',
          frequencyPerDay: 1,
          durationDays: 3,
          withdrawalMeatDays: medicine.withdrawalMeatDays,
          medicineStatus: 'APPROVED',
        },
      ],
    });
    const audit = await auditRows(testApp, 'protocol', res.body.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'protocol.created',
      actorId: admin.user.id,
      newValue: expect.objectContaining({
        protocolCode: body.code,
        versionId: res.body.versions[0].id,
      }),
    });
  });

  it('rejects duplicate codes, unknown/archived/duplicate medicines and empty drug lists', async () => {
    const medicine = await approvedMedicine(testApp);
    const body = protocolBody([medicine.id]);
    await create(vet, body).expect(201);
    expect((await create(vet, body).expect(409)).body.code).toBe(
      'PROTOCOL_CODE_TAKEN',
    );

    const archived = await createMedicine(testApp.prisma, {
      status: MedicineStatus.ARCHIVED,
    });
    const unknown = 'f3f9d0a4-8a63-4c55-9c69-3a4bb7d4f1a0';
    const res = await create(vet, protocolBody([archived.id, unknown])).expect(
      422,
    );
    expect(res.body).toMatchObject({
      code: 'MEDICINE_UNAVAILABLE',
      details: { medicineIds: [archived.id, unknown] },
    });

    expect(
      (await create(vet, protocolBody([medicine.id, medicine.id])).expect(400))
        .body.code,
    ).toBe('DUPLICATE_MEDICINE');
    expect((await create(vet, protocolBody([])).expect(400)).body.code).toBe(
      'DRUGS_REQUIRED',
    );
    // An emergency protocol may carry no drugs at all.
    await create(vet, protocolBody([], { isEmergency: true })).expect(201);
  });

  it.each([
    [{ code: 'lower-case' }],
    [{ code: 'X' }],
    [{ code: 'BAD CODE' }],
    [{ species: 'DRAGON' }],
    [{ version: { title: 'x' } }],
    [{ version: undefined }],
    [{ version: null }],
    [{ version: 'x' }],
    [{ version: [] }],
  ])('rejects invalid body %o', async (overrides) => {
    const medicine = await approvedMedicine(testApp);
    const res = await create(vet, {
      ...protocolBody([medicine.id]),
      ...overrides,
    });
    expect([res.status, res.body.code]).toEqual([400, 'VALIDATION_FAILED']);
  });

  it.each([
    [{ dosePerKg: 0.2 }],
    [{ dosePerKg: '0' }],
    [{ dosePerKg: '1e2' }],
    [{ dosePerKg: '0.00001' }],
    [{ maxSingleDose: null }],
    [{ frequencyPerDay: 25 }],
    [{ durationDays: 0 }],
    [{ route: 'NASAL' }],
  ])('rejects invalid drug %o', async (overrides) => {
    const medicine = await approvedMedicine(testApp);
    const body = protocolBody([medicine.id]);
    Object.assign(body.version.drugs[0], overrides);
    await create(vet, body).expect(400);
  });

  it('FARMER and SUPPORT cannot create protocols', async () => {
    const medicine = await approvedMedicine(testApp);
    for (const who of [farmer, support]) {
      await create(who, protocolBody([medicine.id])).expect(403);
    }
  });

  it('PATCH edits a DRAFT version (replacing drugs) and audits it', async () => {
    const [m1, m2] = await Promise.all([
      approvedMedicine(testApp),
      createMedicine(testApp.prisma),
    ]);
    const created = await create(vet, protocolBody([m1.id])).expect(201);
    const version = created.body.versions[0];
    const res = await testApp
      .http()
      .patch(versionUrl(created.body.id, version.id))
      .set(vet.auth)
      .send({
        title: 'Yangi nom',
        drugs: [
          {
            medicineId: m2.id,
            dosePerKg: '1.5',
            doseUnit: 'MG',
            route: 'ORAL',
            frequencyPerDay: 2,
            durationDays: 5,
          },
        ],
      })
      .expect(200);
    expect(res.body).toMatchObject({
      title: 'Yangi nom',
      status: 'DRAFT',
      drugs: [{ medicineId: m2.id, dosePerKg: '1.5000', durationDays: 5 }],
    });
    const audit = await auditRows(testApp, 'protocol_version', version.id);
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'protocol.version.updated',
      oldValue: expect.objectContaining({ title: 'Mastit davolash' }),
      newValue: expect.objectContaining({ title: 'Yangi nom' }),
    });

    expect(
      (
        await testApp
          .http()
          .patch(versionUrl(created.body.id, version.id))
          .set(vet.auth)
          .send({})
          .expect(400)
      ).body.code,
    ).toBe('EMPTY_UPDATE');
  });

  it('a version is only reachable through its own protocol', async () => {
    const a = await approvedProtocol(testApp);
    const b = await approvedProtocol(testApp);
    await testApp
      .http()
      .patch(versionUrl(a.protocol.id, b.version.id))
      .set(vet.auth)
      .send({ title: 'x' })
      .expect(404);
    await testApp
      .http()
      .get(versionUrl(a.protocol.id, b.version.id))
      .set(vet.auth)
      .expect(404);
  });

  it('approve: VET only, needs APPROVED medicines, audited protocol.version.approved', async () => {
    const draftMedicine = await createMedicine(testApp.prisma);
    const created = await create(vet, protocolBody([draftMedicine.id])).expect(
      201,
    );
    const url = versionUrl(created.body.id, created.body.versions[0].id);

    const refused = await testApp
      .http()
      .post(`${url}/approve`)
      .set(vet.auth)
      .expect(422);
    expect(refused.body).toMatchObject({
      code: 'MEDICINE_NOT_APPROVED',
      details: { medicineIds: [draftMedicine.id] },
    });

    await testApp
      .http()
      .post(`/api/v1/vet/medicines/${draftMedicine.id}/approve`)
      .set(vet.auth)
      .expect(200);
    const res = await testApp
      .http()
      .post(`${url}/approve`)
      .set(vet.auth)
      .expect(200);
    expect(res.body).toMatchObject({
      status: 'APPROVED',
      approvedById: vet.user.id,
    });
    const audit = await auditRows(
      testApp,
      'protocol_version',
      created.body.versions[0].id,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      action: 'protocol.version.approved',
      actorId: vet.user.id,
      actorRole: 'VET',
      oldValue: { status: 'DRAFT', supersededVersionId: null },
      newValue: expect.objectContaining({
        protocolCode: created.body.code,
        status: 'APPROVED',
      }),
    });

    const again = await testApp
      .http()
      .post(`${url}/approve`)
      .set(vet.auth)
      .expect(409);
    expect(again.body.code).toBe('PROTOCOL_VERSION_NOT_DRAFT');
  });

  it('new version: copies the approved one, one DRAFT at a time, approval supersedes', async () => {
    const { protocol, version: v1 } = await approvedProtocol(testApp);
    const res = await testApp
      .http()
      .post(`${PROTOCOLS}/${protocol.id}/versions`)
      .set(admin.auth)
      .expect(201);
    expect(res.body).toMatchObject({
      version: 2,
      status: 'DRAFT',
      title: v1.title,
      condition: v1.condition,
    });
    expect(res.body.drugs).toHaveLength(1);
    const created = await auditRows(testApp, 'protocol_version', res.body.id);
    expect(created[0]).toMatchObject({
      action: 'protocol.version.created',
      newValue: expect.objectContaining({ copiedFromVersionId: v1.id }),
    });

    const second = await testApp
      .http()
      .post(`${PROTOCOLS}/${protocol.id}/versions`)
      .set(admin.auth)
      .expect(409);
    expect(second.body.code).toBe('PROTOCOL_DRAFT_EXISTS');

    await testApp
      .http()
      .post(`${versionUrl(protocol.id, res.body.id)}/approve`)
      .set(vet.auth)
      .expect(200);
    const statuses = await testApp.prisma.protocolVersion.findMany({
      where: { protocolId: protocol.id },
      orderBy: { version: 'asc' },
      select: { version: true, status: true },
    });
    expect(statuses).toEqual([
      { version: 1, status: 'SUPERSEDED' },
      { version: 2, status: 'APPROVED' },
    ]);
    const audit = await auditRows(testApp, 'protocol_version', res.body.id);
    expect(audit.at(-1)).toMatchObject({
      action: 'protocol.version.approved',
      oldValue: { supersededVersionId: v1.id, supersededVersion: 1 },
    });
  });

  it('concurrent new-version requests create exactly one DRAFT', async () => {
    const { protocol } = await approvedProtocol(testApp);
    const responses = await Promise.all(
      [vet, admin, vet].map((who) =>
        testApp
          .http()
          .post(`${PROTOCOLS}/${protocol.id}/versions`)
          .set(who.auth),
      ),
    );
    expect(responses.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(
      await testApp.prisma.protocolVersion.count({
        where: { protocolId: protocol.id, status: 'DRAFT' },
      }),
    ).toBe(1);
  });

  it('archive version: audited; twice → 409; archived approved version hides the protocol from farmers', async () => {
    const { protocol, version } = await approvedProtocol(testApp);
    await testApp
      .http()
      .get(`${PROTOCOLS}/${protocol.id}`)
      .set(farmer.auth)
      .expect(200);
    const res = await testApp
      .http()
      .post(`${versionUrl(protocol.id, version.id)}/archive`)
      .set(vet.auth)
      .expect(200);
    expect(res.body.status).toBe('ARCHIVED');
    const audit = await auditRows(testApp, 'protocol_version', version.id);
    expect(audit[0]).toMatchObject({
      action: 'protocol.version.archived',
      oldValue: { status: 'APPROVED' },
      newValue: { status: 'ARCHIVED' },
    });
    expect(
      (
        await testApp
          .http()
          .post(`${versionUrl(protocol.id, version.id)}/archive`)
          .set(vet.auth)
          .expect(409)
      ).body.code,
    ).toBe('PROTOCOL_VERSION_ARCHIVED');
    await testApp
      .http()
      .get(`${PROTOCOLS}/${protocol.id}`)
      .set(farmer.auth)
      .expect(404);
  });

  it('reads: staff get every version, farmers only the approved content', async () => {
    const { protocol, version } = await approvedProtocol(testApp);
    const draft = await testApp
      .http()
      .post(`${PROTOCOLS}/${protocol.id}/versions`)
      .set(vet.auth)
      .expect(201);

    const staff = await testApp
      .http()
      .get(`${PROTOCOLS}/${protocol.id}`)
      .set(support.auth)
      .expect(200);
    expect(staff.body.versions.map((v: { id: string }) => v.id)).toEqual([
      draft.body.id,
      version.id,
    ]);
    expect(staff.body.approvedVersion.id).toBe(version.id);

    const farmerView = await testApp
      .http()
      .get(`${PROTOCOLS}/${protocol.id}`)
      .set(farmer.auth)
      .expect(200);
    expect(farmerView.body).not.toHaveProperty('versions');
    expect(farmerView.body.approvedVersion).toMatchObject({
      id: version.id,
      status: 'APPROVED',
    });
    expect(farmerView.body.approvedVersion).not.toHaveProperty('createdById');
    expect(farmerView.body.approvedVersion.drugs[0]).not.toHaveProperty(
      'medicineStatus',
    );

    await testApp
      .http()
      .get(versionUrl(protocol.id, version.id))
      .set(farmer.auth)
      .expect(200);
    await testApp
      .http()
      .get(versionUrl(protocol.id, draft.body.id))
      .set(farmer.auth)
      .expect(404);
    await testApp
      .http()
      .get(versionUrl(protocol.id, draft.body.id))
      .set(vet.auth)
      .expect(200);
  });

  it('list paginates and filters by code and species', async () => {
    const tag = uniqueSuffix().toUpperCase();
    const medicine = await approvedMedicine(testApp);
    const a = await create(vet, {
      ...protocolBody([medicine.id]),
      code: `L-${tag}-A`,
    }).expect(201);
    const b = await create(vet, {
      ...protocolBody([medicine.id], { species: 'SHEEP' }),
      code: `L-${tag}-B`,
    }).expect(201);

    const all = await testApp
      .http()
      .get(PROTOCOLS)
      .query({ q: `l-${tag}`, sort: '-code', limit: 5 })
      .set(vet.auth)
      .expect(200);
    expect(all.body).toMatchObject({ page: 1, limit: 5, total: 2 });
    expect(all.body.items.map((p: { id: string }) => p.id)).toEqual([
      b.body.id,
      a.body.id,
    ]);

    const sheep = await testApp
      .http()
      .get(PROTOCOLS)
      .query({ q: `l-${tag}`, species: 'SHEEP' })
      .set(vet.auth)
      .expect(200);
    expect(sheep.body.items.map((p: { id: string }) => p.id)).toEqual([
      b.body.id,
    ]);

    // Neither is approved: farmers see none of them.
    const farmerList = await testApp
      .http()
      .get(PROTOCOLS)
      .query({ q: `l-${tag}` })
      .set(farmer.auth)
      .expect(200);
    expect(farmerList.body).toMatchObject({ items: [], total: 0 });

    await testApp
      .http()
      .get(PROTOCOLS)
      .query({ limit: 0 })
      .set(vet.auth)
      .expect(400);
  });

  it('staff lists embed only the current APPROVED and DRAFT versions', async () => {
    const { protocol } = await approvedProtocol(testApp);
    const ids: string[] = [];
    // v2 approved (v1 superseded), v3 archived, v4 left as DRAFT.
    for (const step of ['approve', 'archive', null] as const) {
      const draft = await testApp
        .http()
        .post(`${PROTOCOLS}/${protocol.id}/versions`)
        .set(vet.auth)
        .expect(201);
      ids.push(draft.body.id);
      if (step) {
        await testApp
          .http()
          .post(`${versionUrl(protocol.id, draft.body.id)}/${step}`)
          .set(vet.auth)
          .expect(200);
      }
    }
    const list = await testApp
      .http()
      .get(PROTOCOLS)
      .query({ q: protocol.code })
      .set(vet.auth)
      .expect(200);
    const [item] = list.body.items;
    expect(item.approvedVersion.id).toBe(ids[0]);
    expect(item.versions.map((v: { id: string }) => v.id)).toEqual([
      ids[2],
      ids[0],
    ]);
    // The detail view keeps the full history.
    const detail = await testApp
      .http()
      .get(`${PROTOCOLS}/${protocol.id}`)
      .set(vet.auth)
      .expect(200);
    expect(detail.body.versions).toHaveLength(4);
  });

  it('an archived medicine blocks approval of a version that uses it', async () => {
    const medicine = await approvedMedicine(testApp);
    const { protocol, version } = await createProtocolWithVersion(
      testApp.prisma,
      { medicineIds: [medicine.id] },
    );
    await testApp
      .http()
      .post(`/api/v1/vet/medicines/${medicine.id}/archive`)
      .set(vet.auth)
      .expect(200);
    const res = await testApp
      .http()
      .post(`${versionUrl(protocol.id, version.id)}/approve`)
      .set(vet.auth)
      .expect(422);
    expect(res.body.code).toBe('MEDICINE_NOT_APPROVED');
  });
});
