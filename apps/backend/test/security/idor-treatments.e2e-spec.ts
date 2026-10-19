import { createTestApp, type TestApp } from '../utils/app.js';
import { createAnimal } from '../utils/factories.js';
import {
  approvedProtocol,
  farmer as createFarmer,
  medicineItem,
  newKey,
  postTreatment,
  treatmentCount,
  TREATMENTS,
  type Farmer,
} from '../vet/support.js';

/**
 * IDOR: a farmer can never read, change or use another farmer's
 * treatments, animals or stock — every such attempt is a 404
 * indistinguishable from an unknown id, and nothing is created or changed.
 */
describe('Security: IDOR on treatments', () => {
  let testApp: TestApp;
  let alice: Farmer;
  let bob: Farmer;
  let protocolVersionId: string;
  let medicineId: string;
  let aliceTreatmentId: string;

  const UNKNOWN = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';

  beforeAll(async () => {
    testApp = await createTestApp({ features: ['vet'] });
    [alice, bob] = await Promise.all([
      createFarmer(testApp),
      createFarmer(testApp),
    ]);
    const protocol = await approvedProtocol(testApp);
    protocolVersionId = protocol.version.id;
    medicineId = protocol.medicineIds[0];
    const res = await postTreatment(testApp, alice.auth, {
      animalId: alice.animal.id,
      protocolVersionId,
    }).expect(201);
    aliceTreatmentId = res.body.id;
  });

  afterAll(async () => {
    await testApp.close();
  });

  /** Error body without the per-request id. */
  const errorBody = ({ requestId, ...rest }: Record<string, unknown>) => {
    expect(typeof requestId).toBe('string');
    return rest;
  };

  it('another farmer’s treatment: GET → 404 like an unknown id', async () => {
    const theirs = await testApp
      .http()
      .get(`${TREATMENTS}/${aliceTreatmentId}`)
      .set(bob.auth)
      .expect(404);
    const unknown = await testApp
      .http()
      .get(`${TREATMENTS}/${UNKNOWN}`)
      .set(bob.auth)
      .expect(404);
    expect(errorBody(theirs.body)).toEqual(errorBody(unknown.body));
    expect(JSON.stringify(theirs.body)).not.toContain(alice.animal.id);
  });

  it('another farmer’s treatment cannot be completed or cancelled', async () => {
    for (const verb of ['complete', 'cancel']) {
      const theirs = await testApp
        .http()
        .post(`${TREATMENTS}/${aliceTreatmentId}/${verb}`)
        .set(bob.auth)
        .expect(404);
      const unknown = await testApp
        .http()
        .post(`${TREATMENTS}/${UNKNOWN}/${verb}`)
        .set(bob.auth)
        .expect(404);
      expect(errorBody(theirs.body)).toEqual(errorBody(unknown.body));
    }
    const row = await testApp.prisma.treatment.findUniqueOrThrow({
      where: { id: aliceTreatmentId },
    });
    expect(row).toMatchObject({
      status: 'ACTIVE',
      completedAt: null,
      cancelledAt: null,
    });
    expect(
      await testApp.prisma.auditLog.count({
        where: { resourceType: 'treatment', resourceId: aliceTreatmentId },
      }),
    ).toBe(1); // only treatment.started
  });

  it('lists never include another farmer’s treatments, even filtered by their animal', async () => {
    const own = await testApp
      .http()
      .get(TREATMENTS)
      .query({ limit: 100 })
      .set(bob.auth)
      .expect(200);
    expect(
      own.body.items.some((t: { id: string }) => t.id === aliceTreatmentId),
    ).toBe(false);
    const filtered = await testApp
      .http()
      .get(TREATMENTS)
      .query({ animalId: alice.animal.id })
      .set(bob.auth)
      .expect(200);
    expect(filtered.body).toMatchObject({ items: [], total: 0 });
  });

  it('starting a treatment on another farmer’s animal → 404, nothing created', async () => {
    const before = await treatmentCount(testApp, alice.animal.id);
    const theirs = await postTreatment(testApp, bob.auth, {
      animalId: alice.animal.id,
      protocolVersionId,
    }).expect(404);
    const unknown = await postTreatment(testApp, bob.auth, {
      animalId: UNKNOWN,
      protocolVersionId,
    }).expect(404);
    expect(errorBody(theirs.body)).toEqual(errorBody(unknown.body));
    expect(await treatmentCount(testApp, alice.animal.id)).toBe(before);
  });

  it('using another farmer’s inventory item → 404, nothing created', async () => {
    const aliceItem = await medicineItem(testApp, alice.farm.id, medicineId);
    const before = await treatmentCount(testApp, bob.animal.id);
    const theirs = await postTreatment(testApp, bob.auth, {
      animalId: bob.animal.id,
      protocolVersionId,
      items: [{ medicineId, inventoryItemId: aliceItem.id }],
    }).expect(404);
    const unknown = await postTreatment(testApp, bob.auth, {
      animalId: bob.animal.id,
      protocolVersionId,
      items: [{ medicineId, inventoryItemId: UNKNOWN }],
    }).expect(404);
    expect(errorBody(theirs.body)).toEqual(errorBody(unknown.body));
    expect(await treatmentCount(testApp, bob.animal.id)).toBe(before);
    expect(
      await testApp.prisma.treatmentDose.count({
        where: { inventoryItemId: aliceItem.id },
      }),
    ).toBe(0);
  });

  it('Idempotency-Keys are per user: reusing Alice’s key never replays her treatment', async () => {
    const key = newKey();
    const aliceRes = await postTreatment(
      testApp,
      alice.auth,
      { animalId: alice.animal.id, protocolVersionId },
      key,
    ).expect(201);
    const bobAnimal = await createAnimal(testApp.prisma, {
      farmId: bob.farm.id,
    });
    const bobRes = await postTreatment(
      testApp,
      bob.auth,
      { animalId: bobAnimal.id, protocolVersionId },
      key,
    ).expect(201);
    expect(bobRes.headers['idempotent-replayed']).toBeUndefined();
    expect(bobRes.body.id).not.toBe(aliceRes.body.id);
    expect(bobRes.body.animalId).toBe(bobAnimal.id);

    // Same key + Alice's payload from Bob: still Bob's own (409, not a replay).
    const probe = await postTreatment(
      testApp,
      bob.auth,
      { animalId: alice.animal.id, protocolVersionId },
      key,
    ).expect(409);
    expect(probe.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(JSON.stringify(probe.body)).not.toContain(aliceRes.body.id);
  });
});
