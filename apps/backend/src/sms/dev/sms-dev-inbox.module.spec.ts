import { devInboxEnabled } from './sms-dev-inbox.module.js';

describe('devInboxEnabled', () => {
  it.each([
    [{ NODE_ENV: 'development', SMS_PROVIDER: 'mock' }, true],
    [{ NODE_ENV: 'development' }, true],
    [{}, false],
    [{ SMS_PROVIDER: 'mock' }, false],
    [{ NODE_ENV: '', SMS_PROVIDER: 'mock' }, false],
    [{ NODE_ENV: 'development', SMS_PROVIDER: 'http' }, false],
    [{ NODE_ENV: 'test', SMS_PROVIDER: 'mock' }, false],
    [{ NODE_ENV: 'production', SMS_PROVIDER: 'mock' }, false],
    [{ NODE_ENV: 'production', SMS_PROVIDER: 'http' }, false],
  ])('%j → %s', (env, expected) => {
    expect(devInboxEnabled(env as NodeJS.ProcessEnv)).toBe(expected);
  });
});
