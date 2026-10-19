import { createTestApp, type TestApp } from '../utils/app.js';

describe('GET /api/v1 (public hello route)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('is public and returns the greeting', async () => {
    const res = await testApp.http().get('/api/v1').expect(200);
    expect(res.text).toBe('Hello World!');
  });

  it('is not served outside the global prefix', async () => {
    const res = await testApp.http().get('/').expect(404);
    expect(res.body).toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'Topilmadi',
    });
  });
});
