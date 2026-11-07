import 'fake-indexeddb/auto';
import { createIdbFs, createMemoryKv, ensureHome } from '@earlyweb/backends';
import { expect, test } from 'vitest';
import { createFsService, TEXT_LIMIT_BYTES } from '../src/services/fs-service.ts';
import { createGrantTable } from '../src/services/grants.ts';

const APP = 'org.x.app';
const code = (c: string) => expect.objectContaining({ code: c });
let n = 0;

async function setup() {
  const fs = await createIdbFs(`fs-service-${n++}`);
  await ensureHome(fs);
  const grants = await createGrantTable(createMemoryKv());
  return { fs, grants, svc: createFsService(fs, grants) };
}

test('resolveRef rewrites /apps/self into the app directory', async () => {
  const { svc } = await setup();
  expect(svc.resolveRef(APP, '/apps/self/notes/a.txt')).toBe('/apps/org.x.app/notes/a.txt');
  expect(svc.resolveRef(APP, '/apps/self')).toBe('/apps/org.x.app');
});

test('resolveRef rejects out-of-scope paths with EPERM', async () => {
  const { svc } = await setup();
  expect(() => svc.resolveRef(APP, '/home/user/Documents/a.txt')).toThrowError(code('EPERM'));
  expect(() => svc.resolveRef(APP, '/apps/self/../org.other.app/a')).toThrowError(code('EPERM'));
  expect(() => svc.resolveRef(APP, '/apps/selfish/a')).toThrowError(code('EPERM'));
  expect(() => svc.resolveRef(APP, '/apps/org.other.app/a')).toThrowError(code('EPERM'));
});

test('resolveRef maps unnormalizable refs to EPERM without leaking', async () => {
  const { svc } = await setup();
  expect(() => svc.resolveRef(APP, '/apps/self/../../etc')).toThrowError(code('EPERM'));
  expect(() => svc.resolveRef(APP, '../../etc')).toThrowError(code('EPERM'));
  expect(() => svc.resolveRef(APP, 'relative.txt')).toThrowError(code('EPERM'));
});

test('resolveRef resolves grant ids only for the owning app', async () => {
  const { svc, grants } = await setup();
  const { id } = grants.issue(APP, '/home/user/Documents/a.txt');
  expect(svc.resolveRef(APP, id)).toBe('/home/user/Documents/a.txt');
  expect(() => svc.resolveRef('org.other.app', id)).toThrowError(code('EPERM'));
  expect(() => svc.resolveRef(APP, 'g_0000000000000000')).toThrowError(code('EPERM'));
});

test('writeText then readText round-trips and creates the app dir', async () => {
  const { svc, fs } = await setup();
  expect(await fs.stat('/apps/org.x.app')).toBeNull();
  await svc.writeText(APP, '/apps/self/a.txt', 'hé');
  expect(await svc.readText(APP, '/apps/self/a.txt')).toBe('hé');
  expect((await fs.stat('/apps/org.x.app'))?.kind).toBe('dir');
});

test('readText over TEXT_LIMIT_BYTES throws EINVAL', async () => {
  const { svc } = await setup();
  await svc.write(APP, '/apps/self/big.txt', new Blob([new Uint8Array(TEXT_LIMIT_BYTES + 1)]));
  await expect(svc.readText(APP, '/apps/self/big.txt')).rejects.toThrowError(code('EINVAL'));
  await svc.write(APP, '/apps/self/ok.txt', new Blob([new Uint8Array(TEXT_LIMIT_BYTES)]));
  expect((await svc.readText(APP, '/apps/self/ok.txt')).length).toBe(TEXT_LIMIT_BYTES);
});

test('list returns FsEntry objects without a path field', async () => {
  const { svc } = await setup();
  await svc.writeText(APP, '/apps/self/a.txt', 'x');
  await svc.mkdir(APP, '/apps/self/sub');
  const entries = await svc.list(APP, '/apps/self');
  expect(entries).toHaveLength(2);
  for (const e of entries) {
    expect(Object.keys(e).sort()).toEqual(['kind', 'mtime', 'name', 'size']);
    expect('path' in e).toBe(false);
  }
  expect(entries.map((e) => e.name).sort()).toEqual(['a.txt', 'sub']);
});

test('stat returns an FsEntry or null', async () => {
  const { svc } = await setup();
  await svc.writeText(APP, '/apps/self/a.txt', 'abc');
  const s = await svc.stat(APP, '/apps/self/a.txt');
  expect(s).toEqual({ name: 'a.txt', kind: 'file', size: 3, mtime: expect.any(Number) });
  expect(s && 'path' in s).toBe(false);
  expect(await svc.stat(APP, '/apps/self/none')).toBeNull();
});

test('read, write, remove work on app paths', async () => {
  const { svc } = await setup();
  await svc.write(APP, '/apps/self/b.bin', new Blob(['xyz']));
  expect(await (await svc.read(APP, '/apps/self/b.bin')).text()).toBe('xyz');
  await svc.remove(APP, '/apps/self/b.bin');
  expect(await svc.stat(APP, '/apps/self/b.bin')).toBeNull();
});

test('rename within scope works', async () => {
  const { svc } = await setup();
  await svc.writeText(APP, '/apps/self/a.txt', 'x');
  await svc.rename(APP, '/apps/self/a.txt', '/apps/self/b.txt');
  expect(await svc.readText(APP, '/apps/self/b.txt')).toBe('x');
  expect(await svc.stat(APP, '/apps/self/a.txt')).toBeNull();
});

test('rename with a destination outside scope throws EPERM and moves nothing', async () => {
  const { svc } = await setup();
  await svc.writeText(APP, '/apps/self/a.txt', 'x');
  await expect(svc.rename(APP, '/apps/self/a.txt', '/home/user/Documents/a.txt')).rejects.toThrowError(
    code('EPERM'),
  );
  await expect(svc.rename(APP, '/home/user/Documents/a.txt', '/apps/self/z.txt')).rejects.toThrowError(
    code('EPERM'),
  );
  expect(await svc.readText(APP, '/apps/self/a.txt')).toBe('x');
});

test('granted files outside the app directory are readable and writable', async () => {
  const { svc, grants } = await setup();
  const { id } = grants.issue(APP, '/home/user/Documents/g.txt');
  await svc.writeText(APP, id, 'granted');
  expect(await svc.readText(APP, id)).toBe('granted');
});
