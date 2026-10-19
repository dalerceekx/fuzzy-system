import {
  MedicineStatus,
  Species,
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
  RECOMMENDATIONS,
  type Actor,
} from './support.js';

const EMERGENCY_ADVICE =
  'Shoshilinch holat: darhol veterinar shifokorga murojaat qiling. Avtomatik dori tavsiya qilinmaydi.';

describe('Vet recommendations', () => {
  let testApp: TestApp;
  let farmer: Actor;
  let vet: Actor;

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['vet'] });
    [farmer, vet] = await Promise.all([
      actor(testApp, UserRole.FARMER),
      actor(testApp, UserRole.VET),
    ]);
  });

  afterAll(async () => {
    await testApp.close();
  });

  const recommend = (who: Actor, query: Record<string, string>) =>
    testApp.http().get(RECOMMENDATIONS).query(query).set(who.auth);
  const ids = (body: { items: Array<{ versionId: string }> }) =>
    body.items.map((item) => item.versionId);

  it('returns only approved, non-emergency versions with all-approved medicines', async () => {
    const condition = `rec-${uniqueSuffix()}`;
    const good = await approvedProtocol(testApp, { condition });
    // Not recommendable: draft, emergency, demo, archived medicine, other species.
    await createProtocolWithVersion(testApp.prisma, { condition });
    await approvedProtocol(testApp, { condition, isEmergency: true });
    await createProtocolWithVersion(testApp.prisma, {
      condition,
      isDemo: true,
    });
    const archivedLater = await approvedMedicine(testApp);
    await approvedProtocol(testApp, {
      condition,
      medicineIds: [archivedLater.id],
    });
    await testApp.prisma.medicine.update({
      where: { id: archivedLater.id },
      data: { status: MedicineStatus.ARCHIVED },
    });
    const sheep = await approvedProtocol(testApp, {
      condition,
      species: Species.SHEEP,
    });

    const res = await recommend(farmer, {
      condition: condition.toUpperCase(),
    }).expect(200);
    expect(res.body).toMatchObject({
      emergency: false,
      advice: null,
      page: 1,
      total: 2,
    });
    expect(ids(res.body).sort()).toEqual(
      [good.version.id, sheep.version.id].sort(),
    );
    const item = res.body.items.find(
      (i: { versionId: string }) => i.versionId === good.version.id,
    );
    expect(item).toMatchObject({
      protocolId: good.protocol.id,
      protocolCode: good.protocol.code,
      species: 'CATTLE',
      version: 1,
      condition,
      drugs: [
        {
          medicineId: good.medicineIds[0],
          dosePerKg: '0.2000',
          doseUnit: 'ML',
          durationDays: 3,
        },
      ],
    });
    expect(item.drugs[0]).not.toHaveProperty('medicineStatus');

    const cattle = await recommend(vet, {
      condition,
      species: 'CATTLE',
    }).expect(200);
    expect(ids(cattle.body)).toEqual([good.version.id]);
  });

  it('emergency=true never returns any medicine', async () => {
    const condition = `emerg-${uniqueSuffix()}`;
    await approvedProtocol(testApp, { condition });
    const res = await recommend(farmer, {
      condition,
      emergency: 'true',
    }).expect(200);
    expect(res.body).toEqual({
      emergency: true,
      advice: EMERGENCY_ADVICE,
      protocols: [],
      items: [],
      page: 1,
      limit: 20,
      total: 0,
    });
  });

  it('treats %, _ and \\ in the condition as literal characters', async () => {
    const tag = uniqueSuffix();
    const literal = await approvedProtocol(testApp, {
      condition: `a%b_c\\d-${tag}`,
    });
    await approvedProtocol(testApp, { condition: `aXbYc\\d-${tag}` });
    await approvedProtocol(testApp, { condition: `aXbYcZd-${tag}` });

    const exact = await recommend(farmer, {
      condition: `a%b_c\\d-${tag}`,
    }).expect(200);
    expect(ids(exact.body)).toEqual([literal.version.id]);

    for (const condition of [`%-${tag}`, `_-${tag}`, `a%-${tag}`]) {
      const res = await recommend(farmer, { condition }).expect(200);
      expect(res.body.total).toBe(0);
    }
  });

  it('a superseded version is replaced by the newly approved one', async () => {
    const condition = `sup-${uniqueSuffix()}`;
    const { protocol, version: v1 } = await approvedProtocol(testApp, {
      condition,
    });
    const v2 = await testApp
      .http()
      .post(`/api/v1/vet/protocols/${protocol.id}/versions`)
      .set(vet.auth)
      .expect(201);
    expect(ids((await recommend(farmer, { condition })).body)).toEqual([v1.id]);
    await testApp
      .http()
      .post(
        `/api/v1/vet/protocols/${protocol.id}/versions/${v2.body.id}/approve`,
      )
      .set(vet.auth)
      .expect(200);
    expect(ids((await recommend(farmer, { condition })).body)).toEqual([
      v2.body.id,
    ]);
  });

  it('only FARMER and VET may ask; queries are validated', async () => {
    for (const role of [UserRole.ADMIN, UserRole.SUPPORT]) {
      const who = await actor(testApp, role);
      await recommend(who, {}).expect(403);
    }
    await testApp.http().get(RECOMMENDATIONS).expect(401);
    await recommend(farmer, { emergency: 'yes' }).expect(400);
    await recommend(farmer, { species: 'DRAGON' }).expect(400);
    await recommend(farmer, { condition: 'x'.repeat(201) }).expect(400);
    await recommend(farmer, { limit: '101' }).expect(400);
  });

  it('a DRAFT medicine in an approved version is never recommended', async () => {
    // Defense in depth: approval refuses DRAFT medicines, but a protocol can
    // reference one only through direct DB edits; it must still be hidden.
    const condition = `dm-${uniqueSuffix()}`;
    const draft = await createMedicine(testApp.prisma);
    const protocol = await createProtocolWithVersion(testApp.prisma, {
      condition,
      medicineIds: [draft.id],
    });
    expect(protocol.version.status).toBe('DRAFT');
    const res = await recommend(farmer, { condition }).expect(200);
    expect(res.body.total).toBe(0);
  });
});
