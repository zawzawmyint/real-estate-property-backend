import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { LocalStorage } from '../src/infrastructure/storage/local-storage.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'real-estate-storage-'));

  roots.push(root);

  return { root, storage: new LocalStorage(root, 'http://localhost:4311') };
}

it('saves generated keys, resolves a public URL and deletes files', async () => {
  const { root, storage } = await setup();
  const key = await storage.save(Buffer.from('photo'), '.jpg');

  expect(key).toMatch(/^[0-9a-f-]{36}\.jpg$/);
  expect(await readFile(join(root, key), 'utf8')).toBe('photo');
  expect(storage.resolveUrl(key)).toBe(`http://localhost:4311/media/${key}`);
  await storage.delete(key);
  await expect(readFile(join(root, key))).rejects.toMatchObject({
    code: 'ENOENT',
  });
  await storage.delete(key);
});
it('rejects traversal, Windows paths, encoded paths and extension injection', async () => {
  const { storage } = await setup();

  for (const key of [
    '../secret',
    '/etc/passwd',
    'C:\\secret',
    '\\\\server\\share',
    '..%2fsecret',
    'nested/image.jpg',
    'file:secret',
    'image.jpg:stream',
    'CON',
    'a\\..\\secret',
  ]) {
    await expect(storage.delete(key)).rejects.toThrow(/storage key/i);
    expect(() => storage.resolveUrl(key)).toThrow(/storage key/i);
  }

  await expect(storage.save(Buffer.from('x'), '/../file')).rejects.toThrow(
    /extension/i,
  );
});
it('refuses symlink targets without deleting their destination', async () => {
  const { root, storage } = await setup();
  const outside = await mkdtemp(join(tmpdir(), 'real-estate-outside-'));

  roots.push(outside);
  await writeFile(join(outside, 'secret'), 'private');

  const key = '00000000-0000-4311-8000-000000000000.jpg';

  await symlink(outside, join(root, key), 'junction');
  await expect(storage.delete(key)).rejects.toThrow(/symbolic link/i);
  expect(await readFile(join(outside, 'secret'), 'utf8')).toBe('private');
});
