import { expandIpv6, normalizeIp, rateLimitIpKey } from './client-ip.js';
import { RequestContext } from './request-context.js';
import { resolveRequestId } from './request-id.js';

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('resolveRequestId', () => {
  it.each([
    'abcdefgh',
    'trace-0001.edge_proxy',
    'A'.repeat(64),
    '0b9a3c3e-8d6a-4a62-b3a5-6a8f1f0c2e11',
  ])('keeps a safe inbound id %s from a trusted proxy', (id) => {
    expect(resolveRequestId(id, true)).toBe(id);
  });

  it('never accepts an inbound id from an untrusted (direct) client', () => {
    expect(resolveRequestId('trace-0001.edge_proxy', false)).toMatch(UUID_V4);
  });

  it.each([
    undefined,
    '',
    'short',
    'A'.repeat(65),
    'has space in it',
    'line\nbreak-123',
    'abcdefgh\r\nlevel=error',
    'abcdefgh\\nlevel=error',
    'quote"injection',
    '../../etc/passwd',
    ['abcdefgh', 'ijklmnop'],
    12345678,
  ])('replaces %j with a new UUID v4', (value) => {
    expect(resolveRequestId(value, true)).toMatch(UUID_V4);
  });
});

describe('RequestContext', () => {
  it('is scoped to the async call tree and patchable', async () => {
    expect(RequestContext.get()).toBeUndefined();
    const seen = await RequestContext.run(
      { requestId: 'req-00000001' },
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        RequestContext.set({ userId: 'user-1' });
        return RequestContext.get();
      },
    );
    expect(seen).toEqual({ requestId: 'req-00000001', userId: 'user-1' });
    expect(RequestContext.get()).toBeUndefined();
    RequestContext.set({ userId: 'ignored' });
    expect(RequestContext.get()).toBeUndefined();
  });

  it('does not mutate the caller object', () => {
    const data = { requestId: 'req-00000002' };
    RequestContext.run(data, () => RequestContext.set({ userId: 'x' }));
    expect(data).toEqual({ requestId: 'req-00000002' });
  });
});

describe('client IP helpers', () => {
  it('normalizes IPv4-mapped IPv6 addresses', () => {
    expect(normalizeIp('::ffff:10.0.0.1')).toBe('10.0.0.1');
    expect(normalizeIp('::1')).toBe('::1');
    expect(normalizeIp(undefined)).toBeUndefined();
  });

  it('buckets IPv4 per address and IPv6 per /64', () => {
    expect(rateLimitIpKey('203.0.113.5')).toBe('203.0.113.5');
    expect(rateLimitIpKey('::ffff:203.0.113.5')).toBe('203.0.113.5');
    expect(rateLimitIpKey('2001:db8:1:2::abcd')).toBe(
      '2001:0db8:0001:0002::/64',
    );
    expect(rateLimitIpKey('2001:db8:1:2:ffff:ffff:ffff:ffff')).toBe(
      '2001:0db8:0001:0002::/64',
    );
    expect(rateLimitIpKey('2001:DB8:1:2::1%eth0')).toBe(
      '2001:0db8:0001:0002::/64',
    );
    expect(rateLimitIpKey('64:ff9b::192.0.2.33')).toBe(
      '0064:ff9b:0000:0000::/64',
    );
    expect(rateLimitIpKey(undefined)).toBe('unknown');
    expect(rateLimitIpKey('not-an-ip')).toBe('unknown');
  });

  it('expands IPv6 addresses to 8 groups', () => {
    expect(expandIpv6('::1')).toEqual([
      '0000',
      '0000',
      '0000',
      '0000',
      '0000',
      '0000',
      '0000',
      '0001',
    ]);
    expect(expandIpv6('fe80::')).toEqual([
      'fe80',
      '0000',
      '0000',
      '0000',
      '0000',
      '0000',
      '0000',
      '0000',
    ]);
    expect(expandIpv6('1::2::3')).toBeNull();
  });
});
