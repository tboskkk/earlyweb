import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { createIdbFs } from '../src/index.ts';

let n = 0;
const fresh = () => createIdbFs(`fs-test-${n++}`);
const code = (c: string) => expect.objectContaining({ code: c });

test('write then read and stat', async () => {
  const fs = await fresh();
  await fs.write('/a.txt', new Blob(['hi']));
  expect(await (await fs.read('/a.txt')).text()).toBe('hi');
  expect((await fs.stat('/a.txt'))?.size).toBe(2);
  expect(await fs.stat('/nope')).toBeNull();
});

test('write into missing parent rejects ENOENT', async () => {
  const fs = await fresh();
  await expect(fs.write('/missing/a.txt', new Blob(['x']))).rejects.toThrowError(code('ENOENT'));
});

test('mkdir creates parents and is idempotent', async () => {
  const fs = await fresh();
  await fs.mkdir('/x/y/z');
  await fs.mkdir('/x/y/z');
  expect((await fs.stat('/x/y'))?.kind).toBe('dir');
  expect((await fs.stat('/x/y/z'))?.kind).toBe('dir');
});

test('mkdir over a file rejects EEXIST', async () => {
  const fs = await fresh();
  await fs.write('/f', new Blob(['x']));
  await expect(fs.mkdir('/f')).rejects.toThrowError(code('EEXIST'));
});

test('read of dir is EINVAL, of missing is ENOENT', async () => {
  const fs = await fresh();
  await fs.mkdir('/d');
  await expect(fs.read('/d')).rejects.toThrowError(code('EINVAL'));
  await expect(fs.read('/nope')).rejects.toThrowError(code('ENOENT'));
});

test('list returns direct children, dirs first then by name', async () => {
  const fs = await fresh();
  await fs.mkdir('/x/y/z');
  await fs.mkdir('/x/b');
  await fs.write('/x/a.txt', new Blob(['1']));
  await fs.write('/x/Z.txt', new Blob(['1']));
  const names = (await fs.list('/x')).map((s) => `${s.kind}:${s.name}`);
  expect(names).toEqual(['dir:b', 'dir:y', 'file:Z.txt', 'file:a.txt']);
  await expect(fs.list('/nope')).rejects.toThrowError(code('ENOENT'));
});

test('remove removes descendants', async () => {
  const fs = await fresh();
  await fs.mkdir('/x/y/z');
  await fs.write('/x/y/f', new Blob(['1']));
  await fs.remove('/x');
  expect(await fs.stat('/x')).toBeNull();
  expect(await fs.stat('/x/y/z')).toBeNull();
  expect(await fs.stat('/x/y/f')).toBeNull();
});

test('rename moves descendants', async () => {
  const fs = await fresh();
  await fs.mkdir('/x/y/z');
  await fs.write('/x/y/f', new Blob(['hey']));
  await fs.rename('/x', '/w');
  expect((await fs.stat('/w/y/z'))?.kind).toBe('dir');
  expect(await (await fs.read('/w/y/f')).text()).toBe('hey');
  expect(await fs.stat('/x')).toBeNull();
});

test('rename onto existing path rejects EEXIST', async () => {
  const fs = await fresh();
  await fs.mkdir('/x');
  await fs.mkdir('/w');
  await expect(fs.rename('/x', '/w')).rejects.toThrowError(code('EEXIST'));
});

test('data survives reopening', async () => {
  const name = `fs-reopen-${n++}`;
  const a = await createIdbFs(name);
  await a.write('/p.txt', new Blob(['persist']));
  const b = await createIdbFs(name);
  expect(await (await b.read('/p.txt')).text()).toBe('persist');
});
