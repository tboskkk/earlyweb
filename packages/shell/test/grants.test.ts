import { createMemoryKv } from '@earlyweb/backends';
import { expect, test } from 'vitest';
import { createGrantTable } from '../src/services/grants.ts';

const code = (c: string) => expect.objectContaining({ code: c });
const flush = () => new Promise((r) => setTimeout(r, 0));

test('issue returns an id and display name', async () => {
  const t = await createGrantTable(createMemoryKv());
  const ref = t.issue('a', '/home/user/Documents/x.txt');
  expect(ref).toEqual({ id: expect.stringMatching(/^g_[0-9a-f]{16}$/), name: 'x.txt' });
});

test('resolve returns the path for the owning app', async () => {
  const t = await createGrantTable(createMemoryKv());
  const { id } = t.issue('a', '/home/user/Documents/x.txt');
  expect(t.resolve('a', id)).toBe('/home/user/Documents/x.txt');
});

test('resolve rejects another app and unknown ids with EPERM', async () => {
  const t = await createGrantTable(createMemoryKv());
  const { id } = t.issue('a', '/home/user/Documents/x.txt');
  expect(() => t.resolve('b', id)).toThrowError(code('EPERM'));
  expect(() => t.resolve('a', 'g_0000000000000000')).toThrowError(code('EPERM'));
});

test('a new table over the same kv still resolves the id', async () => {
  const kv = createMemoryKv();
  const t = await createGrantTable(kv);
  const { id } = t.issue('a', '/home/user/Documents/x.txt');
  await flush();
  const t2 = await createGrantTable(kv);
  expect(t2.resolve('a', id)).toBe('/home/user/Documents/x.txt');
  expect(() => t2.resolve('b', id)).toThrowError(code('EPERM'));
});

test('revokeApp makes resolve throw EPERM and persists', async () => {
  const kv = createMemoryKv();
  const t = await createGrantTable(kv);
  const { id } = t.issue('a', '/home/user/Documents/x.txt');
  const other = t.issue('b', '/home/user/Documents/y.txt');
  t.revokeApp('a');
  expect(() => t.resolve('a', id)).toThrowError(code('EPERM'));
  expect(t.resolve('b', other.id)).toBe('/home/user/Documents/y.txt');
  await flush();
  const t2 = await createGrantTable(kv);
  expect(() => t2.resolve('a', id)).toThrowError(code('EPERM'));
  expect(t2.resolve('b', other.id)).toBe('/home/user/Documents/y.txt');
});
