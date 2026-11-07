import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { createIdbFs, createMemoryKv, ensureHome } from '../src/index.ts';

test('ensureHome creates layout and clears /tmp', async () => {
  const fs = await createIdbFs('home-test');
  await ensureHome(fs);
  const dirs = [
    '/home/user/Desktop',
    '/home/user/Documents',
    '/home/user/Music',
    '/home/user/Pictures',
    '/home/user/Downloads',
    '/apps',
    '/system',
    '/tmp',
  ];
  for (const d of dirs) expect((await fs.stat(d))?.kind).toBe('dir');
  await fs.write('/tmp/junk', new Blob(['x']));
  await ensureHome(fs);
  expect(await fs.stat('/tmp/junk')).toBeNull();
  expect((await fs.stat('/tmp'))?.kind).toBe('dir');
});

test('memory kv get/set/delete', async () => {
  const kv = createMemoryKv();
  expect(await kv.get('k')).toBeUndefined();
  await kv.set('k', { a: 1 });
  expect(await kv.get('k')).toEqual({ a: 1 });
  await kv.delete('k');
  expect(await kv.get('k')).toBeUndefined();
});
