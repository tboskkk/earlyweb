import 'fake-indexeddb/auto';
import { createIdbFs, createMemoryKv, ensureHome } from '@earlyweb/backends';
import type { Manifest } from '@earlyweb/protocol';
import { glass } from '@earlyweb/themes';
import { signal } from '@preact/signals';
import { afterEach, expect, test } from 'vitest';
import { createBroker } from '../src/broker/broker.ts';
import { appHandlers } from '../src/broker/methods/app.ts';
import { fsHandlers } from '../src/broker/methods/fs.ts';
import { themeHandlers } from '../src/broker/methods/theme.ts';
import { windowHandlers } from '../src/broker/methods/window.ts';
import type { AppInstance } from '../src/host/handshake.ts';
import { createFsService } from '../src/services/fs-service.ts';
import { createGrantTable } from '../src/services/grants.ts';
import { createWindowStore } from '../src/state/windows.ts';

const EVIL = 'org.evil.app';
const NOTEPAD = 'org.earlyweb.notepad';
let n = 0;
let closers: (() => void)[] = [];
afterEach(() => {
  for (const c of closers) c();
  closers = [];
});

async function setup() {
  const fs = await createIdbFs(`hostile-${n++}`);
  await ensureHome(fs);
  await fs.mkdir('/home/user/Documents');
  await fs.write('/home/user/Documents/secret.txt', new Blob(['TOP SECRET']));
  await fs.mkdir(`/apps/${NOTEPAD}`);
  await fs.write(`/apps/${NOTEPAD}/x`, new Blob(['notepad private']));
  const grants = await createGrantTable(createMemoryKv());
  const svc = createFsService(fs, grants);
  const store = createWindowStore(signal({ width: 1200, height: 800 }));
  const open = (appId: string) =>
    store.open({
      appId,
      instanceId: `inst-${appId}`,
      title: 'orig',
      icon: '',
      w: 400,
      h: 300,
      minW: 200,
      minH: 150,
      resizable: true,
    });
  const victimWin = open(NOTEPAD);
  const evilWin = open(EVIL);
  const broker = createBroker({
    handlers: {
      ...appHandlers({ onReady: () => {} }),
      ...windowHandlers(store),
      ...fsHandlers(svc),
      ...themeHandlers(() => glass),
    },
  });
  const instance: AppInstance = {
    instanceId: `inst-${EVIL}`,
    appId: EVIL,
    manifest: { permissions: [] } as unknown as Manifest,
    windowId: evilWin,
    launch: { args: [] },
  };
  const ch = new MessageChannel();
  const conn = broker.attach(instance, ch.port1 as never);
  const waiting = new Map<number, (m: Record<string, unknown>) => void>();
  ch.port2.addEventListener('message', (e) => {
    const m = e.data as Record<string, unknown>;
    if (m.t === 'result') waiting.get(m.id as number)?.(m);
  });
  ch.port2.start();
  closers.push(() => {
    conn.detach();
    ch.port2.close();
  });
  let id = 0;
  const call = (method: string, params: unknown) =>
    new Promise<Record<string, unknown>>((resolve) => {
      const i = ++id;
      waiting.set(i, resolve);
      ch.port2.postMessage({ t: 'call', id: i, method, params });
    });
  const errorOf = async (method: string, params: unknown) => {
    const r = await call(method, params);
    expect(r.ok).toBe(false);
    return r.error as { code: string; message: string };
  };
  return { fs, grants, store, victimWin, evilWin, call, errorOf };
}

test('the secret and notepad files really exist (EPERM below is not vacuous)', async () => {
  const { fs } = await setup();
  expect(await (await fs.read('/home/user/Documents/secret.txt')).text()).toBe('TOP SECRET');
  expect(await (await fs.read(`/apps/${NOTEPAD}/x`)).text()).toBe('notepad private');
});

test('a legitimately granted caller can read the secret, a hostile one cannot', async () => {
  const { grants, call } = await setup();
  // The same file IS readable through the same broker path when legitimately granted.
  const g = grants.issue(EVIL, '/home/user/Documents/secret.txt');
  const ok = await call('fs.readText', { ref: g.id });
  expect(ok).toMatchObject({ ok: true, value: 'TOP SECRET' });
});

test('fs.readText of an out-of-scope absolute path -> EPERM', async () => {
  const { errorOf } = await setup();
  expect((await errorOf('fs.readText', { ref: '/home/user/Documents/secret.txt' })).code).toBe('EPERM');
});

test('traversal out of /apps/self into another app -> EPERM', async () => {
  const { errorOf } = await setup();
  expect((await errorOf('fs.readText', { ref: `/apps/self/../${NOTEPAD}/x` })).code).toBe('EPERM');
});

test('a grant id issued to another app -> EPERM', async () => {
  const { grants, errorOf } = await setup();
  const g = grants.issue(NOTEPAD, '/home/user/Documents/secret.txt');
  expect((await errorOf('fs.readText', { ref: g.id })).code).toBe('EPERM');
});

test('dialog.open -> EPERM (permission check precedes the missing handler)', async () => {
  const { errorOf } = await setup();
  expect((await errorOf('dialog.open', {})).code).toBe('EPERM');
});

test('fs.rename out of scope -> EPERM and nothing is created', async () => {
  const { fs, call, errorOf } = await setup();
  await call('fs.writeText', { ref: '/apps/self/a', text: 'x' });
  expect((await errorOf('fs.rename', { from: '/apps/self/a', to: '/tmp/a' })).code).toBe('EPERM');
  expect(await fs.stat('/tmp/a')).toBeNull();
  expect(await fs.stat(`/apps/${EVIL}/a`)).not.toBeNull();
});

test('window calls act only on the caller window, whatever the params say', async () => {
  const { store, victimWin, evilWin, call } = await setup();
  const r = await call('window.setTitle', { title: 'pwned', windowId: victimWin });
  expect(r.ok).toBe(true);
  expect(store.windows.value.find((w) => w.id === victimWin)?.title).toBe('orig');
  expect(store.windows.value.find((w) => w.id === evilWin)?.title).toBe('pwned');
});
