import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants.js';
import { MetadataScanner, ModulesContainer } from '@nestjs/core';
import { IS_PUBLIC_KEY } from '../../src/common/decorators/public.decorator.js';
import { ROLES_KEY } from '../../src/common/decorators/roles.decorator.js';
import { createTestApp, type TestApp } from '../utils/app.js';
import {
  ProbeController,
  ProbeMixedController,
} from './support/probe.controller.js';

interface RouteInfo {
  route: string;
  isPublic: boolean;
  roles: unknown;
}

/** Every handler of every controller registered in the real AppModule. */
function collectRoutes(testApp: TestApp): RouteInfo[] {
  const scanner = new MetadataScanner();
  const routes: RouteInfo[] = [];
  for (const module of testApp.app.get(ModulesContainer).values()) {
    for (const wrapper of module.controllers.values()) {
      const controller = wrapper.metatype as
        (new (...args: never[]) => unknown) | undefined;
      if (!controller) continue;
      const prototype = controller.prototype as Record<string, unknown>;
      for (const name of scanner.getAllMethodNames(prototype)) {
        const handler = prototype[name] as object;
        if (Reflect.getMetadata(PATH_METADATA, handler) === undefined) continue;
        const read = (key: string) =>
          (Reflect.getMetadata(key, handler) as unknown) ??
          (Reflect.getMetadata(key, controller) as unknown);
        routes.push({
          route: `${String(Reflect.getMetadata(METHOD_METADATA, handler))} ${controller.name}.${name}`,
          isPublic: read(IS_PUBLIC_KEY) === true,
          roles: read(ROLES_KEY),
        });
      }
    }
  }
  return routes;
}

function offenders(testApp: TestApp): string[] {
  return collectRoutes(testApp)
    .filter(({ isPublic, roles }) => {
      const hasRoles = Array.isArray(roles) && roles.length > 0;
      return isPublic === hasRoles || (roles !== undefined && !hasRoles);
    })
    .map(
      ({ route, isPublic, roles }) =>
        `${route} (public=${isPublic}, roles=${JSON.stringify(roles)})`,
    );
}

describe('Route authorization metadata (fail-closed)', () => {
  let testApp: TestApp;

  beforeAll(async () => {
    testApp = await createTestApp();
  });

  afterAll(async () => {
    await testApp.close();
  });

  it('finds the registered routes', () => {
    const routes = collectRoutes(testApp).map((r) => r.route);
    expect(routes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('HealthController.check'),
      ]),
    );
  });

  it('every route has exactly one of @Public() or a non-empty @Roles(...)', () => {
    expect(offenders(testApp)).toEqual([]);
  });

  it('self-check: the scan flags routes with neither or both decorators', async () => {
    const withProbe = await createTestApp({
      controllers: [ProbeController, ProbeMixedController],
    });
    try {
      const flagged = offenders(withProbe);
      expect(flagged).toEqual([
        expect.stringContaining('ProbeController.noMetadata'),
        expect.stringContaining('ProbeController.both'),
        expect.stringContaining('ProbeMixedController.publicInsideRoles'),
      ]);
      // And at runtime such a handler is protected, not public.
      const res = await withProbe
        .http()
        .get('/api/v1/test-probe-mixed/public-inside-roles')
        .expect(401);
      expect(res.text).not.toContain('leaked');
    } finally {
      await withProbe.close();
    }
  });
});
