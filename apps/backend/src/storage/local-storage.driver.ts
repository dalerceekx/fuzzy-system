import { constants, mkdirSync, realpathSync } from 'node:fs';
import { access, mkdir, open, realpath, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import {
  assertSafeStorageKey,
  UnsafeStorageKeyError,
  type StorageDriver,
} from './storage.types.js';

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;

function isInside(base: string, candidate: string): boolean {
  const rel = relative(base, candidate);
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

/**
 * Filesystem storage for development and tests only (env validation forbids
 * it in production). The base directory must be absolute and outside the
 * project directory, so uploads can never be served or executed as code.
 */
export class LocalStorageDriver implements StorageDriver {
  readonly kind = 'local' as const;
  private readonly baseDir: string;

  constructor(baseDir: string, projectDir: string = process.cwd()) {
    if (!isAbsolute(baseDir)) {
      throw new Error('UPLOAD_LOCAL_DIR must be an absolute path');
    }
    const insideProject = (base: string, project: string) =>
      base === project || isInside(project, base);
    if (insideProject(resolve(baseDir), resolve(projectDir))) {
      throw new Error('UPLOAD_LOCAL_DIR must be outside the project directory');
    }
    mkdirSync(baseDir, { recursive: true, mode: DIR_MODE });
    // Again with real paths, so a symlink cannot point into the project.
    const realBase = realpathSync(baseDir);
    if (insideProject(realBase, realpathSync(projectDir))) {
      throw new Error('UPLOAD_LOCAL_DIR must be outside the project directory');
    }
    this.baseDir = realBase;
  }

  async put(key: string, body: Buffer, _contentType: string): Promise<void> {
    const path = await this.resolveKey(key, true);
    // O_EXCL: never overwrite; O_NOFOLLOW: never write through a symlink.
    const handle = await open(
      path,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        constants.O_NOFOLLOW,
      FILE_MODE,
    );
    try {
      await handle.writeFile(body);
    } finally {
      await handle.close();
    }
  }

  async getStream(key: string): Promise<NodeJS.ReadableStream> {
    const path = await this.resolveKey(key, false);
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    return handle.createReadStream();
  }

  async delete(key: string): Promise<void> {
    const path = await this.resolveKey(key, false);
    try {
      await unlink(path);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }

  getSignedDownloadUrl(): Promise<string | null> {
    return Promise.resolve(null);
  }

  async healthCheck(): Promise<void> {
    await access(this.baseDir, constants.R_OK | constants.W_OK);
  }

  /** Validated key → absolute path that is guaranteed to be inside baseDir. */
  private async resolveKey(
    key: string,
    createParents: boolean,
  ): Promise<string> {
    assertSafeStorageKey(key);
    const path = resolve(this.baseDir, key);
    if (!isInside(this.baseDir, path)) throw new UnsafeStorageKeyError();

    const parent = dirname(path);
    if (createParents) await mkdir(parent, { recursive: true, mode: DIR_MODE });
    let realParent: string;
    try {
      realParent = await realpath(parent);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT' && !createParents) {
        return path; // open()/unlink() report the missing file
      }
      throw err;
    }
    if (realParent !== this.baseDir && !isInside(this.baseDir, realParent)) {
      throw new UnsafeStorageKeyError();
    }
    return `${realParent}${sep}${path.slice(parent.length + 1)}`;
  }
}
