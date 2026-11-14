import { expect, test } from 'vitest';
import { createTauriKv, type Invoke } from '../src/index.ts';

test('get of null is undefined; set and delete pass their args', async () => {
  const calls: [string, unknown][] = [];
  const invoke: Invoke = async (cmd, args) => {
    calls.push([cmd, args]);
    return cmd === 'kv_get' && (args as { key: string }).key === 'there' ? { a: 1 } : null;
  };
  const kv = createTauriKv(invoke);
  expect(await kv.get('missing')).toBeUndefined();
  expect(await kv.get('there')).toEqual({ a: 1 });
  await kv.set('session', [1, 2]);
  await kv.delete('session');
  expect(calls).toEqual([
    ['kv_get', { key: 'missing' }],
    ['kv_get', { key: 'there' }],
    ['kv_set', { key: 'session', value: [1, 2] }],
    ['kv_delete', { key: 'session' }],
  ]);
});

test('kv errors become EwError', async () => {
  const kv = createTauriKv(async () => {
    throw { code: 'EINVAL', message: 'bad key' };
  });
  await expect(kv.get('../x')).rejects.toThrowError(expect.objectContaining({ code: 'EINVAL' }));
});
