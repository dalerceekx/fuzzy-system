import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalStorageDriver } from './local-storage.driver.js';
import { buildStorageKey, UnsafeStorageKeyError } from './storage.types.js';

async function readAll(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}

describe('LocalStorageDriver', () => {
  let root: string;
  let base: string;
  let driver: LocalStorageDriver;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'mf-storage-'));
    base = join(root, 'uploads');
    driver = new LocalStorageDriver(base);
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('stores, streams and deletes a file with private permissions', async () => {
    const key = buildStorageKey('png');
    await driver.put(key, Buffer.from('png-bytes'), 'image/png');
    expect((await readAll(await driver.getStream(key))).toString()).toBe(
      'png-bytes',
    );

    const file = join(base, key);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(statSync(join(base, 'files')).mode & 0o777).toBe(0o700);

    await driver.delete(key);
    await expect(driver.getStream(key)).rejects.toMatchObject({
      code: 'ENOENT',
    });
    await expect(driver.delete(key)).resolves.toBeUndefined();
  });

  it('never overwrites an existing key', async () => {
    const key = buildStorageKey('pdf');
    await driver.put(key, Buffer.from('first'), 'application/pdf');
    await expect(
      driver.put(key, Buffer.from('second'), 'application/pdf'),
    ).rejects.toMatchObject({ code: 'EEXIST' });
    expect(readFileSync(join(base, key), 'utf8')).toBe('first');
  });

  it.each([
    '../escape.jpg',
    'files/../../escape.jpg',
    '/etc/passwd.jpg',
    'files\\..\\x.jpg',
    'x.svg',
  ])('refuses traversal / unsafe key %s for every operation', async (key) => {
    await expect(
      driver.put(key, Buffer.from('x'), 'image/jpeg'),
    ).rejects.toBeInstanceOf(UnsafeStorageKeyError);
    await expect(driver.getStream(key)).rejects.toBeInstanceOf(
      UnsafeStorageKeyError,
    );
    await expect(driver.delete(key)).rejects.toBeInstanceOf(
      UnsafeStorageKeyError,
    );
  });

  it('does not follow a symlink planted at the target path', async () => {
    const key = 'files/2026/10/planted.jpg';
    mkdirSync(join(base, 'files/2026/10'), { recursive: true });
    const outside = join(root, 'outside.txt');
    writeFileSync(outside, 'secret');
    symlinkSync(outside, join(base, key));
    await expect(driver.getStream(key)).rejects.toMatchObject({
      code: 'ELOOP',
    });
    await expect(
      driver.put(key, Buffer.from('x'), 'image/jpeg'),
    ).rejects.toBeDefined();
    expect(readFileSync(outside, 'utf8')).toBe('secret');
  });

  it('refuses a symlinked directory that leads outside the base directory', async () => {
    const outsideDir = join(root, 'elsewhere');
    mkdirSync(outsideDir);
    mkdirSync(join(base, 'files'), { recursive: true });
    symlinkSync(outsideDir, join(base, 'files', 'evil'));
    await expect(
      driver.put('files/evil/x.jpg', Buffer.from('x'), 'image/jpeg'),
    ).rejects.toBeInstanceOf(UnsafeStorageKeyError);
  });

  it('cannot sign URLs and reports health', async () => {
    await expect(driver.getSignedDownloadUrl()).resolves.toBeNull();
    await expect(driver.healthCheck()).resolves.toBeUndefined();
  });

  it('refuses a relative directory or one inside the project directory', () => {
    expect(() => new LocalStorageDriver('uploads')).toThrow('absolute');
    expect(
      () =>
        new LocalStorageDriver(
          join(process.cwd(), 'uploads-test-should-not-exist'),
        ),
    ).toThrow('outside');
    expect(() => new LocalStorageDriver(process.cwd())).toThrow('outside');
    const project = join(root, 'project');
    mkdirSync(project);
    symlinkSync(join(project), join(root, 'link-to-project'));
    expect(
      () =>
        new LocalStorageDriver(
          join(root, 'link-to-project', 'uploads'),
          project,
        ),
    ).toThrow('outside');
  });
});
