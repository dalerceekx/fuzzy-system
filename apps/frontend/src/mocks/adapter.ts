import { AxiosError, AxiosHeaders, type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios';
import type { MockServer } from './server';

function pathOf(config: InternalAxiosRequestConfig): { path: string; query: Record<string, string> } {
  const url = new URL(config.url ?? '', 'http://mock.local/');
  const base = new URL(config.baseURL ?? '/', 'http://mock.local/').pathname.replace(/\/$/, '');
  const relative = url.pathname.startsWith(base) ? url.pathname.slice(base.length) : url.pathname;
  const query: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    query[key] = value;
  });
  for (const [key, value] of Object.entries((config.params ?? {}) as Record<string, unknown>)) {
    if (value !== undefined && value !== null) query[key] = String(value);
  }
  return { path: relative || '/', query };
}

function parseBody(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  if (data === '') return undefined;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return data;
  }
}

/**
 * Axios adapter that answers from the in-memory mock server. Error
 * statuses reject with a real AxiosError, exactly like the HTTP adapter.
 */
export function createMockAdapter(server: MockServer, { latencyMs = 0 } = {}): AxiosAdapter {
  return async (config) => {
    if (latencyMs > 0) await new Promise((resolve) => setTimeout(resolve, latencyMs));
    const { path, query } = pathOf(config);
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(AxiosHeaders.from(config.headers).toJSON())) {
      if (typeof value === 'string') headers[key.toLowerCase()] = value;
    }
    const result = server.handle({
      method: (config.method ?? 'get').toUpperCase(),
      path,
      query,
      headers,
      body: parseBody(config.data),
    });
    const response = {
      // Serialize like a real network hop: callers never share objects with
      // the mock database.
      data: result.body === undefined ? '' : (JSON.parse(JSON.stringify(result.body)) as unknown),
      status: result.status,
      statusText: String(result.status),
      headers: new AxiosHeaders(result.headers ?? {}),
      config,
      request: {},
    };
    const valid = config.validateStatus ? config.validateStatus(result.status) : result.status >= 200 && result.status < 300;
    if (valid) return response;
    throw new AxiosError(
      `Request failed with status code ${result.status}`,
      result.status >= 500 ? AxiosError.ERR_BAD_RESPONSE : AxiosError.ERR_BAD_REQUEST,
      config,
      response.request,
      response,
    );
  };
}
