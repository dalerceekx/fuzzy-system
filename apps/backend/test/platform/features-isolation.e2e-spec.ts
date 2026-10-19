import { createTestApp, type TestApp } from '../utils/app.js';

// Module agents boot only the features they test; unfinished feature modules
// must never be loaded in that mode.
describe('createTestApp({ features })', () => {
  let testApp: TestApp;

  afterEach(async () => {
    await testApp?.close();
  });

  it('boots the platform alone', async () => {
    testApp = await createTestApp({ features: [] });
    await testApp.http().get('/api/v1/health/live').expect(200);
  });

  it('boots the platform with selected features', async () => {
    testApp = await createTestApp({ features: ['sms'] });
    await testApp.http().get('/api/v1/health/live').expect(200);
    expect(testApp.sms.messages()).toBeDefined();
  });
});
