import { expect, it, vi } from 'vitest';
import { bootSession } from '../src/state/boot-session.ts';

it('load throwing leaves the saver disabled and skips restore', async () => {
  const restore = vi.fn();
  const enable = vi.fn();
  const onError = vi.fn();
  await bootSession({ load: () => Promise.reject(new Error('idb')), restore, enable, onError });
  expect(enable).not.toHaveBeenCalled();
  expect(restore).not.toHaveBeenCalled();
  expect(onError).toHaveBeenCalledTimes(1);
});

it('restore throwing still enables the saver', async () => {
  const enable = vi.fn();
  const onError = vi.fn();
  await bootSession({
    load: async () => [1],
    restore: () => {
      throw new Error('bad record');
    },
    enable,
    onError,
  });
  expect(enable).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenCalledTimes(1);
});

it('success restores the loaded records then enables', async () => {
  const order: string[] = [];
  await bootSession({
    load: async () => ['r'],
    restore: (r) => order.push(`restore:${r}`),
    enable: () => order.push('enable'),
  });
  expect(order).toEqual(['restore:r', 'enable']);
});
