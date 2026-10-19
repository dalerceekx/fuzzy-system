import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Supply-chain guarantees of the CI configuration (repo root .github/).

const REPO = join(fileURLToPath(new URL('../..', import.meta.url)), '../..');
const WORKFLOWS = join(REPO, '.github/workflows');
const workflows = readdirSync(WORKFLOWS)
  .filter((name) => name.endsWith('.yml'))
  .map((name) => ({ name, text: readFileSync(join(WORKFLOWS, name), 'utf8') }));
const ci = workflows.find((w) => w.name === 'ci.yml')!.text;

describe('GitHub workflows', () => {
  it.each(workflows.map((w) => [w.name, w.text]))(
    '%s pins every action to a full commit SHA with a version comment',
    (_name, text) => {
      const uses = [...text.matchAll(/uses:\s*(\S+)(.*)$/gm)];
      expect(uses.length).toBeGreaterThan(0);
      for (const [, ref, rest] of uses) {
        expect(ref).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
        expect(rest).toMatch(/# v\d+\.\d+\.\d+/);
      }
    },
  );

  it.each(workflows.map((w) => [w.name, w.text]))(
    '%s defaults to read-only permissions and never persists credentials',
    (_name, text) => {
      expect(text).toMatch(/^permissions:\n\s+contents: read$/m);
      const checkouts = text.match(/actions\/checkout@/g) ?? [];
      const persisted = text.match(/persist-credentials: false/g) ?? [];
      expect(persisted.length).toBe(checkouts.length);
      expect(text).not.toMatch(/pull_request_target/);
    },
  );

  it('ci.yml runs quality, e2e, audit, secrets, sast and docker jobs', () => {
    for (const job of [
      'quality',
      'e2e',
      'audit',
      'secrets',
      'sast',
      'docker',
    ]) {
      expect(ci).toMatch(new RegExp(`^  ${job}:$`, 'm'));
    }
    expect(ci).toMatch(/npm ci/);
    expect(ci).not.toMatch(/npm (install|i)\b/);
    expect(ci).toMatch(/npm audit --audit-level=high/);
    for (const step of [
      'typecheck',
      'lint',
      'format:check',
      'test',
      'test:e2e',
    ]) {
      expect(ci).toContain(`npm run ${step}`);
    }
    expect(ci).toMatch(/working-directory: apps\/backend/);
    expect(ci).toMatch(/fetch-depth: 0/);
    expect(ci).toMatch(/--redact/);
    for (const ruleset of [
      'p/default',
      'p/nodejs',
      'p/typescript',
      'p/secrets',
    ]) {
      expect(ci).toContain(`--config ${ruleset}`);
    }
    expect(ci).toMatch(/--severity HIGH,CRITICAL/);
    expect(ci).toMatch(/--ignore-unfixed/);
    expect(ci).toMatch(/--exit-code 1[\s\S]*meningfermam-api:ci/);
  });

  it('pins scanner and service images to explicit versions', () => {
    const images = [...ci.matchAll(/(?:IMAGE: |image: )(\S+)/g)].map(
      (m) => m[1],
    );
    expect(images.length).toBeGreaterThanOrEqual(5);
    for (const image of images) {
      expect(image).toMatch(/:v?\d+\.\d+(\.\d+)?([-.][\w.]+)?$/);
      expect(image).not.toMatch(/:latest$/);
    }
  });
});
