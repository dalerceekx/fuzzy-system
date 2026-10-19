import { randomUUID } from 'node:crypto';
import { IdempotencyService } from '../../src/idempotency/idempotency.service.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import { loginAs, type LoggedIn } from '../utils/auth.js';
import { createUser } from '../utils/factories.js';
import { ProbeController } from './support/probe.controller.js';

const ROUTE = '/api/v1/test-probe/idempotent-farm';

describe('Idempotency', () => {
  let testApp: TestApp;
  let auth: LoggedIn;
  let userId: string;

  beforeAll(async () => {
    testApp = await createTestApp({ controllers: [ProbeController] });
    const { user } = await createUser(testApp.prisma);
    userId = user.id;
    auth = await loginAs(testApp, user);
  });

  afterAll(async () => {
    await testApp.close();
  });

  const newKey = () => `key-${randomUUID()}`;
  const farmsNamed = (name: string) =>
    testApp.prisma.farm.count({ where: { ownerId: userId, name } });

  it('replays the stored response for the same key and payload', async () => {
    const key = newKey();
    const name = `Ferma ${randomUUID()}`;
    const first = await testApp
      .http()
      .post(ROUTE)
      .set(auth.authHeader)
      .set('Idempotency-Key', key)
      .send({ name })
      .expect(201);
    expect(first.headers['idempotent-replayed']).toBeUndefined();

    const second = await testApp
      .http()
      .post(ROUTE)
      .set(auth.authHeader)
      .set('Idempotency-Key', key)
      .send({ name })
      .expect(201);
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body).toStrictEqual(first.body);
    expect(await farmsNamed(name)).toBe(1);
  });

  it('treats key order in the payload as the same request (canonical hash)', async () => {
    const key = newKey();
    const name = `Ferma ${randomUUID()}`;
    await testApp
      .http()
      .post(ROUTE)
      .set(auth.authHeader)
      .set('Idempotency-Key', key)
      .send({ name, fail: 'no' })
      .expect(201);
    const replay = await testApp
      .http()
      .post(ROUTE)
      .set(auth.authHeader)
      .set('Idempotency-Key', key)
      .set('Content-Type', 'application/json')
      .send(`{"fail":"no","name":${JSON.stringify(name)}}`)
      .expect(201);
    expect(replay.headers['idempotent-replayed']).toBe('true');
  });

  it('answers 409 IDEMPOTENCY_KEY_REUSED for the same key with another payload', async () => {
    const key = newKey();
    const name = `Ferma ${randomUUID()}`;
    await testApp
      .http()
      .post(ROUTE)
      .set(auth.authHeader)
      .set('Idempotency-Key', key)
      .send({ name })
      .expect(201);
    const res = await testApp
      .http()
      .post(ROUTE)
      .set(auth.authHeader)
      .set('Idempotency-Key', key)
      .send({ name: `${name} (boshqa)` })
      .expect(409);
    expect(res.body).toMatchObject({
      statusCode: 409,
      code: 'IDEMPOTENCY_KEY_REUSED',
    });
    expect(await farmsNamed(`${name} (boshqa)`)).toBe(0);
  });

  it('runs concurrent duplicates exactly once and replays to the others', async () => {
    const key = newKey();
    const name = `Ferma ${randomUUID()}`;
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        testApp
          .http()
          .post(ROUTE)
          .set(auth.authHeader)
          .set('Idempotency-Key', key)
          .send({ name }),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    expect(
      responses.filter((r) => r.headers['idempotent-replayed'] === 'true'),
    ).toHaveLength(4);
    expect(new Set(responses.map((r) => JSON.stringify(r.body))).size).toBe(1);
    expect(await farmsNamed(name)).toBe(1);
  });

  it('does not cache errors: a failed operation rolls the key back', async () => {
    const key = newKey();
    const name = `Ferma ${randomUUID()}`;
    const failed = await testApp
      .http()
      .post(ROUTE)
      .set(auth.authHeader)
      .set('Idempotency-Key', key)
      .send({ name, fail: 'yes' })
      .expect(422);
    expect(failed.body.code).toBe('PROBE_FAILED');
    expect(await farmsNamed(name)).toBe(0);
    expect(
      await testApp.prisma.idempotencyKey.count({ where: { userId, key } }),
    ).toBe(0);

    const retried = await testApp
      .http()
      .post(ROUTE)
      .set(auth.authHeader)
      .set('Idempotency-Key', key)
      .send({ name })
      .expect(201);
    expect(retried.headers['idempotent-replayed']).toBeUndefined();
    expect(await farmsNamed(name)).toBe(1);
  });

  it('scopes keys per user', async () => {
    const key = newKey();
    const { user: other } = await createUser(testApp.prisma);
    const otherAuth = await loginAs(testApp, other);
    const name = `Ferma ${randomUUID()}`;
    await testApp
      .http()
      .post(ROUTE)
      .set(auth.authHeader)
      .set('Idempotency-Key', key)
      .send({ name })
      .expect(201);
    const res = await testApp
      .http()
      .post(ROUTE)
      .set(otherAuth.authHeader)
      .set('Idempotency-Key', key)
      .send({ name })
      .expect(201);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(
      await testApp.prisma.farm.count({ where: { ownerId: other.id, name } }),
    ).toBe(1);
  });

  it('replaces an expired key instead of replaying it', async () => {
    const key = newKey();
    const name = `Ferma ${randomUUID()}`;
    await testApp
      .http()
      .post(ROUTE)
      .set(auth.authHeader)
      .set('Idempotency-Key', key)
      .send({ name })
      .expect(201);
    const past = Date.now() - 60_000;
    await testApp.prisma.idempotencyKey.updateMany({
      where: { userId, key },
      data: { createdAt: new Date(past - 1000), expiresAt: new Date(past) },
    });
    const res = await testApp
      .http()
      .post(ROUTE)
      .set(auth.authHeader)
      .set('Idempotency-Key', key)
      .send({ name })
      .expect(201);
    expect(res.headers['idempotent-replayed']).toBeUndefined();
    expect(await farmsNamed(name)).toBe(2);
  });

  it.each([
    [undefined, 'IDEMPOTENCY_KEY_REQUIRED'],
    ['short', 'IDEMPOTENCY_KEY_INVALID'],
    ['has spaces in it', 'IDEMPOTENCY_KEY_INVALID'],
    ['a'.repeat(129), 'IDEMPOTENCY_KEY_INVALID'],
  ])('rejects the key %s with 400 %s', async (key, code) => {
    const request = testApp.http().post(ROUTE).set(auth.authHeader);
    if (key !== undefined) request.set('Idempotency-Key', key);
    const res = await request.send({ name: 'x' }).expect(400);
    expect(res.body.code).toBe(code);
  });

  it('rejects an invalid key or scope passed straight to the service', async () => {
    const service = testApp.app.get(IdempotencyService);
    const operation = () => Promise.resolve({ status: 200, body: {} });
    await expect(
      service.execute(
        { userId, scope: 'test.scope', key: 'bad key!', request: {} },
        operation,
      ),
    ).rejects.toMatchObject({
      code: 'IDEMPOTENCY_KEY_INVALID',
    });
    await expect(
      service.execute(
        { userId, scope: 'Bad Scope', key: newKey(), request: {} },
        operation,
      ),
    ).rejects.toThrow('Invalid idempotency scope');
  });
});
