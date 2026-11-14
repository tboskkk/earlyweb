import type { FsBackend, Invoke } from '@earlyweb/backends';
import { signal } from '@preact/signals';
import { afterEach, expect, test, vi } from 'vitest';
import { CANARY_PATH, HOSTILE_IPC_APP, runSelftest, waitForTitle } from '../src/selftest.ts';
import { createWindowStore, type WindowStore } from '../src/state/windows.ts';

afterEach(() => vi.useRealTimers());

const newStore = () => createWindowStore(signal({ width: 1280, height: 800 }));

function openWindow(store: WindowStore, appId: string, title = 'Starting') {
  return store.open({
    appId,
    instanceId: crypto.randomUUID(),
    title,
    icon: '',
    w: 400,
    h: 300,
    minW: 100,
    minH: 100,
    resizable: true,
  });
}

test("waitForTitle resolves when the app's title gets the prefix", async () => {
  const store = newStore();
  const id = openWindow(store, 'org.a.app');
  const p = waitForTitle(store, 'org.a.app', 'RESULT ', 1000);
  store.update(id, { title: 'still running' });
  store.update(id, { title: 'RESULT blocked' });
  await expect(p).resolves.toBe('RESULT blocked');
});

test('resolves at once if the title already has the prefix', async () => {
  const store = newStore();
  openWindow(store, 'org.a.app', 'RESULT LEAK:popup');
  await expect(waitForTitle(store, 'org.a.app', 'RESULT ', 1000)).resolves.toBe('RESULT LEAK:popup');
});

test("ignores other apps' titles", async () => {
  vi.useFakeTimers();
  const store = newStore();
  const other = openWindow(store, 'org.other.app');
  const mine = openWindow(store, 'org.a.app');
  const p = waitForTitle(store, 'org.a.app', 'RESULT ', 1000);
  let settled: string | undefined;
  void p.then((t) => {
    settled = t;
  });
  store.update(other, { title: 'RESULT forged' });
  await vi.advanceTimersByTimeAsync(10);
  expect(settled).toBeUndefined();
  store.update(mine, { title: 'RESULT blocked' });
  await expect(p).resolves.toBe('RESULT blocked');
});

test('rejects after timeout', async () => {
  vi.useFakeTimers();
  const store = newStore();
  openWindow(store, 'org.a.app');
  const p = waitForTitle(store, 'org.a.app', 'RESULT ', 1000);
  const check = expect(p).rejects.toThrow(/timed out/);
  await vi.advanceTimersByTimeAsync(1001);
  await check;
});

type Call = { cmd: string; args: unknown };

function fakes(store: WindowStore, resultTitle: string | null) {
  const calls: Call[] = [];
  const fsCalls: { op: string; path: string; text?: string }[] = [];
  const invoke: Invoke = async (cmd, args) => {
    calls.push({ cmd, args });
    return cmd === 'e2e_canary' ? 'tok-123' : null;
  };
  const fs = {
    write: async (path: string, blob: Blob) => {
      fsCalls.push({ op: 'write', path, text: await blob.text() });
    },
    read: async (path: string) => {
      fsCalls.push({ op: 'read', path });
      return new Blob([]);
    },
    stat: async (path: string) => {
      fsCalls.push({ op: 'stat', path });
      return null;
    },
  } as unknown as FsBackend;
  const launched: string[] = [];
  const launcher = {
    launch: (appId: string) => {
      launched.push(appId);
      const id = openWindow(store, appId);
      if (resultTitle !== null) queueMicrotask(() => store.update(id, { title: resultTitle }));
      return 'inst';
    },
  };
  return { calls, fsCalls, invoke, fs, launcher, launched };
}

test('runSelftest writes the canary and reports the title', async () => {
  const store = newStore();
  const f = fakes(store, 'RESULT blocked');
  await runSelftest({ fs: f.fs, invoke: f.invoke, launcher: f.launcher, store });
  expect(f.calls).toEqual([
    { cmd: 'e2e_canary', args: undefined },
    { cmd: 'e2e_report', args: { app: 'blocked' } },
  ]);
  // Exactly one write of the token to the canary, and the shell never reads it back.
  expect(f.fsCalls).toEqual([{ op: 'write', path: CANARY_PATH, text: 'tok-123' }]);
  expect(f.launched).toEqual([HOSTILE_IPC_APP]);
});

test('a leak verdict is passed through unchanged', async () => {
  const store = newStore();
  const f = fakes(store, 'RESULT LEAK:internalsInvoke,popup');
  await runSelftest({ fs: f.fs, invoke: f.invoke, launcher: f.launcher, store });
  expect(f.calls.at(-1)).toEqual({ cmd: 'e2e_report', args: { app: 'LEAK:internalsInvoke,popup' } });
});

test('no result in time reports timeout', async () => {
  vi.useFakeTimers();
  const store = newStore();
  const f = fakes(store, null);
  const done = runSelftest({ fs: f.fs, invoke: f.invoke, launcher: f.launcher, store });
  await vi.advanceTimersByTimeAsync(60_001);
  await done;
  expect(f.calls.at(-1)).toEqual({ cmd: 'e2e_report', args: { app: 'timeout' } });
});
