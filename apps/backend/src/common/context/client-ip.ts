import { isIPv4, isIPv6 } from 'node:net';

/** `::ffff:10.0.0.1` → `10.0.0.1`; other values are returned unchanged. */
export function normalizeIp(ip: string | undefined | null): string | undefined {
  if (!ip) return undefined;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped && isIPv4(mapped[1])) return mapped[1];
  return ip;
}

/**
 * Rate-limit bucket for a client address. IPv6 clients usually control a
 * whole /64, so they are bucketed per /64 instead of per address.
 */
export function rateLimitIpKey(ip: string | undefined | null): string {
  const normalized = normalizeIp(ip);
  if (!normalized) return 'unknown';
  if (isIPv4(normalized)) return normalized;
  const groups = isIPv6(normalized) ? expandIpv6(normalized) : null;
  return groups ? `${groups.slice(0, 4).join(':')}::/64` : 'unknown';
}

/** Full 8-group form of a valid IPv6 address (zone id dropped). */
export function expandIpv6(ip: string): string[] | null {
  let address = ip.split('%')[0].toLowerCase();
  const dotted = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(address);
  if (dotted) {
    if (!isIPv4(dotted[1])) return null;
    const [a, b, c, d] = dotted[1].split('.').map(Number);
    const tail = `${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
    address = address.slice(0, -dotted[1].length) + tail;
  }
  const halves = address.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || head.length + fill + tail.length !== 8) return null;
  const groups = [...head, ...Array<string>(fill).fill('0'), ...tail];
  if (!groups.every((group) => /^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.map((group) => group.padStart(4, '0'));
}
