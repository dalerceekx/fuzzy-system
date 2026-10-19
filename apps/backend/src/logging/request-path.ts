import type { IncomingMessage } from 'node:http';
import { truncate } from '../common/strings.js';

const HEALTH_PATH = /^\/api\/v1\/health(?:\/|$)/;

/** Request path without query string or fragment (queries may hold tokens). */
export function requestPath(req: IncomingMessage): string {
  const url = (req as { originalUrl?: string }).originalUrl ?? req.url ?? '/';
  return truncate(url.split(/[?#]/, 1)[0], 2048);
}

export function isHealthRequest(req: IncomingMessage): boolean {
  return HEALTH_PATH.test(requestPath(req));
}
