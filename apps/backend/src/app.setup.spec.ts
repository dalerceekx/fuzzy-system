import { buildHelmetOptions, parseTrustProxy } from './app.setup.js';

describe('parseTrustProxy', () => {
  it.each([
    ['false', false],
    ['', false],
    ['1', 1],
    ['2', 2],
    ['0', false],
    ['3', 3],
    ['loopback', ['loopback']],
    ['loopback, uniquelocal', ['loopback', 'uniquelocal']],
    ['10.0.0.0/8, 172.16.0.0/12', ['10.0.0.0/8', '172.16.0.0/12']],
    ['172.18.0.1', ['172.18.0.1']],
    ['fd00::/64', ['fd00::/64']],
  ])('%j → %j', (input, expected) => {
    expect(parseTrustProxy(input)).toEqual(expected);
  });

  it.each([
    'true',
    '4',
    '100',
    '0.0.0.0/0',
    '::/0',
    '0.0.0.0/1',
    '10.0.0.0/7',
    '2001:db8::/31',
    '10.0.0.0/33',
    '10.0.0.0/8/1',
    'proxy.example.com',
    'loopback, *',
    '1.2.3',
  ])('rejects %j (would trust spoofable client headers)', (input) => {
    expect(() => parseTrustProxy(input)).toThrow(/TRUST_PROXY/);
  });
});

describe('buildHelmetOptions', () => {
  it('enables HSTS only in production with HTTPS required', () => {
    expect(
      buildHelmetOptions({
        NODE_ENV: 'production',
        HTTPS_REQUIRED: true,
        HSTS_MAX_AGE_SECONDS: 31_536_000,
      }).hsts,
    ).toEqual({ maxAge: 31_536_000, includeSubDomains: true });
    expect(
      buildHelmetOptions({
        NODE_ENV: 'production',
        HTTPS_REQUIRED: false,
        HSTS_MAX_AGE_SECONDS: 1,
      }).hsts,
    ).toBe(false);
    expect(
      buildHelmetOptions({
        NODE_ENV: 'development',
        HTTPS_REQUIRED: true,
        HSTS_MAX_AGE_SECONDS: 1,
      }).hsts,
    ).toBe(false);
    expect(
      buildHelmetOptions({
        NODE_ENV: 'test',
        HTTPS_REQUIRED: true,
        HSTS_MAX_AGE_SECONDS: 1,
      }).hsts,
    ).toBe(false);
  });

  it('uses a strict API content security policy', () => {
    const options = buildHelmetOptions({
      NODE_ENV: 'development',
      HTTPS_REQUIRED: false,
      HSTS_MAX_AGE_SECONDS: 0,
    });
    expect(options.contentSecurityPolicy).toEqual({
      useDefaults: false,
      directives: {
        defaultSrc: ["'none'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
        formAction: ["'none'"],
      },
    });
    expect(options.referrerPolicy).toEqual({ policy: 'no-referrer' });
    expect(options.crossOriginResourcePolicy).toEqual({ policy: 'same-site' });
  });
});
