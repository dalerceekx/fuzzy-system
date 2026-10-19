import { once } from 'node:events';
import { Agent, get, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createTestApp, type TestApp } from '../utils/app.js';
import { ProbeController, probeSignals } from './support/probe.controller.js';

type Outcome = { status: number; body: string } | 'refused';

/** GET resolving with status + body, or 'refused' on a connection error. */
function request(url: string, agent: Agent | false = false): Promise<Outcome> {
  return new Promise((resolve) => {
    get(url, { agent }, (res) => {
      let body = '';
      res.on('data', (chunk: Buffer) => (body += chunk.toString()));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
    }).on('error', () => resolve('refused'));
  });
}

/** Resolves once server.close() has been called (listener stopped). */
async function stoppedListening(server: Server): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (server.listening) {
    if (Date.now() > deadline) throw new Error('server kept listening');
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('Graceful shutdown', () => {
  let testApp: TestApp;
  let server: Server;
  let baseUrl: string;

  beforeEach(async () => {
    testApp = await createTestApp({ controllers: [ProbeController] });
    await testApp.app.listen(0, '127.0.0.1');
    server = testApp.app.getHttpServer() as Server;
    // Long enough that only the app's own drain logic can close the socket
    // promptly (Node would otherwise keep an idle keep-alive socket this long).
    server.keepAliveTimeout = 60_000;
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}/api/v1`;
  });

  afterEach(async () => {
    probeSignals.emit('release');
    await testApp.close().catch(() => undefined);
  });

  it('lets in-flight requests finish and refuses new ones while closing', async () => {
    const entered = once(probeSignals, 'held-entered');
    const inFlight = request(`${baseUrl}/test-probe/held`);
    await entered;

    const closing = testApp.close();
    await stoppedListening(server);
    const late = await request(`${baseUrl}/health/live`);
    expect(late === 'refused' || late.status === 503).toBe(true);

    probeSignals.emit('release');
    expect(await inFlight).toStrictEqual({
      status: 200,
      body: '{"done":true}',
    });
    await closing;
    expect(await request(`${baseUrl}/health/live`)).toBe('refused');
  });

  it('closes a busy keep-alive socket right after its response (no wait for keepAliveTimeout)', async () => {
    const agent = new Agent({ keepAlive: true, maxSockets: 1 });
    try {
      // Warm the keep-alive socket, then keep it busy across shutdown.
      expect(await request(`${baseUrl}/health/live`, agent)).toMatchObject({
        status: 200,
      });
      const entered = once(probeSignals, 'held-entered');
      const inFlight = request(`${baseUrl}/test-probe/held`, agent);
      await entered;

      const closing = testApp.close();
      await stoppedListening(server);
      probeSignals.emit('release');
      expect(await inFlight).toMatchObject({ status: 200 });

      const startedAt = Date.now();
      await closing;
      expect(Date.now() - startedAt).toBeLessThan(5_000);
    } finally {
      agent.destroy();
    }
  });
});
