import { EwError } from '@earlyweb/protocol';
import { expect, test } from 'vitest';
import { createTauriFs, type FsStat, type Invoke } from '../src/index.ts';

type Call = { cmd: string; args: unknown; options: unknown };

function fake(reply: (cmd: string, args: unknown) => unknown = () => null) {
  const calls: Call[] = [];
  const invoke: Invoke = async (cmd, args, options) => {
    calls.push({ cmd, args, options });
    return reply(cmd, args);
  };
  return { calls, invoke };
}

const code = (c: string) => expect.objectContaining({ code: c });

test('write sends raw bytes and an encoded path header', async () => {
  const { calls, invoke } = fake();
  await createTauriFs(invoke).write('/home/user/a b#.txt', new Blob(['hi']));
  expect(calls).toHaveLength(1);
  const call = calls[0] as Call;
  expect(call.cmd).toBe('fs_write');
  expect(call.args).toBeInstanceOf(Uint8Array);
  expect([...(call.args as Uint8Array)]).toEqual([104, 105]);
  expect(call.options).toEqual({ headers: { 'x-ew-path': '%2Fhome%2Fuser%2Fa%20b%23.txt' } });
});

test('rust errors become EwError', async () => {
  const rejectWith = (e: unknown) =>
    createTauriFs(async () => {
      throw e;
    });
  const err = await rejectWith({ code: 'EPERM', message: 'x' })
    .stat('/home/user')
    .catch((e: unknown) => e);
  expect(err).toBeInstanceOf(EwError);
  expect(err).toMatchObject({ code: 'EPERM', message: 'x' });
  await expect(rejectWith({ code: 'EWHAT', message: 'y' }).stat('/a')).rejects.toThrowError(code('EINVAL'));
  const str = await rejectWith('boom')
    .stat('/a')
    .catch((e: unknown) => e);
  expect(str).toBeInstanceOf(EwError);
  expect(str).toMatchObject({ code: 'EINVAL', message: 'boom' });
});

test('list is sorted like idb-fs', async () => {
  const st = (name: string, kind: 'file' | 'dir'): FsStat => ({
    path: `/x/${name}`,
    name,
    kind,
    size: 0,
    mtime: 0,
  });
  const { calls, invoke } = fake(() => [
    st('b.txt', 'file'),
    st('z', 'dir'),
    st('B', 'file'),
    st('a', 'dir'),
  ]);
  const names = (await createTauriFs(invoke).list('/x/')).map((s) => `${s.kind}:${s.name}`);
  expect(names).toEqual(['dir:a', 'dir:z', 'file:B', 'file:b.txt']);
  expect(calls[0]).toMatchObject({ cmd: 'fs_list', args: { path: '/x' } });
});

test('read returns a Blob', async () => {
  const { calls, invoke } = fake(() => new Uint8Array([104, 105]).buffer);
  const blob = await createTauriFs(invoke).read('/home/user/a.txt');
  expect(blob).toBeInstanceOf(Blob);
  expect(await blob.text()).toBe('hi');
  expect(calls[0]).toMatchObject({ cmd: 'fs_read', args: { path: '/home/user/a.txt' } });
});

test('paths are normalized before sending', async () => {
  const { calls, invoke } = fake();
  const fs = createTauriFs(invoke);
  expect(await fs.stat('/a/./b')).toBeNull();
  expect(calls[0]).toMatchObject({ cmd: 'fs_stat', args: { path: '/a/b' } });
  await expect(fs.stat('rel')).rejects.toThrowError(code('EINVAL'));
  await fs.rename('/a//b', '/a/../c');
  expect(calls[1]).toMatchObject({ cmd: 'fs_rename', args: { from: '/a/b', to: '/c' } });
  expect(calls).toHaveLength(2);
});

test('mkdir and remove send their command', async () => {
  const { calls, invoke } = fake();
  const fs = createTauriFs(invoke);
  await fs.mkdir('/home/user/d');
  await fs.remove('/home/user/d');
  expect(calls.map((c) => [c.cmd, c.args])).toEqual([
    ['fs_mkdir', { path: '/home/user/d' }],
    ['fs_remove', { path: '/home/user/d' }],
  ]);
});
