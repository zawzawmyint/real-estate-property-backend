import { randomUUID } from 'node:crypto';
import {
  mkdir,
  lstat,
  realpath,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Storage } from './storage.js';

const keyPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|avif|gif)$/;
const extensionPattern = /^\.(jpg|jpeg|png|webp|avif|gif)$/;

export class StorageKeyError extends Error {}

export class LocalStorage implements Storage {
  private readonly root: string;

  constructor(
    root: string,
    private readonly publicOrigin: string,
  ) {
    this.root = resolve(root);
  }

  private validateKey(key: string) {
    if (!keyPattern.test(key)) throw new StorageKeyError('Invalid storage key');
  }

  async save(content: Buffer, extension: string): Promise<string> {
    if (!extensionPattern.test(extension))
      throw new Error('Unsupported image extension');

    await mkdir(this.root, { recursive: true });
    const key = `${randomUUID()}${extension}`;
    await writeFile(join(this.root, key), content, { flag: 'wx' });

    return key;
  }

  /** Validates a flat key and refuses symlinks before it can be served or deleted. */
  async resolveFile(key: string): Promise<string> {
    this.validateKey(key);

    if (!(await stat(this.root)).isDirectory()) {
      throw new Error('Storage root must be a directory');
    }

    const file = join(this.root, key);
    const fileStat = await lstat(file);

    if (fileStat.isSymbolicLink())
      throw new StorageKeyError('Storage symbolic link is not allowed');
    if (!fileStat.isFile())
      throw new StorageKeyError('Storage key is not a regular file');

    const canonicalRoot = await realpath(this.root);

    if ((await realpath(file)) !== join(canonicalRoot, key))
      throw new StorageKeyError('Storage path escapes root');

    return file;
  }

  async delete(key: string): Promise<void> {
    this.validateKey(key);

    try {
      await unlink(await this.resolveFile(key));
    } catch (error) {
      if (!(
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ))
        throw error;
    }
  }

  resolveUrl(key: string): string {
    this.validateKey(key);

    return `${this.publicOrigin.replace(/\/$/, '')}/media/${key}`;
  }
}
