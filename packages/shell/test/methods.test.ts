import 'fake-indexeddb/auto';
import { createIdbFs, createMemoryKv, ensureHome } from '@earlyweb/backends';
import { EwError, type Manifest } from '@earlyweb/protocol';
import { glass } from '@earlyweb/themes';
import { signal } from '@preact/signals';
import { expect, test, vi } from 'vitest';
import { appHandlers } from '../src/broker/methods/app.ts';
import { fsHandlers } from '../src/broker/methods/fs.ts';
import { themeHandlers } from '../src/broker/methods/theme.ts';
import { windowHandlers } from '../src/broker/methods/window.ts';
import type { AppInstance } from '../src/host/handshake.ts';
import { createFsService } from '../src/services/fs-service.ts';
import { createGrantTable } from '../src/services/grants.ts';
import { CHROME_H, CHROME_W } from '../src/state/content-size.ts';
import { createWindowStore, TASKBAR_H } from '../src/state/windows.ts';

const APP = 'org.x.app';
let n = 0;

function windows() {
  const store = createWindowStore(signal({ width: 1200, height: 800 }));
  const open = (appId: string) =>
    store.open({
      appId,
      instanceId: `inst-${appId}`,
      title: 't',
      icon: '',
      w: 400,
      h: 300,
      minW: 200,
      minH: 150,
      resizable: true,
    });
  const ctxFor = (appId: string, windowId: string) => ({
    instance: {
      instanceId: `inst-${appId}`,
      appId,
      manifest: { permissions: [] } as unknown as Manifest,
      windowId,
      launch: { args: [] },
    } as AppInstance,
  });
  return { store, open, ctxFor };
}

test('app.ready calls onReady with the caller instance and returns null', async () => {
  const { open, ctxFor } = windows();
  const onReady = vi.fn();
  const h = appHandlers({ onReady })['app.ready'];
  expect(await h?.(ctxFor(APP, open(APP)), {})).toBeNull();
  expect(onReady).toHaveBeenCalledWith(`inst-${APP}`);
});

test('window.setTitle updates the title of the caller window only', async () => {
  const { store, open, ctxFor } = windows();
  const a = open(APP);
  const b = open('org.y.app');
  await windowHandlers(store)['window.setTitle']?.(ctxFor(APP, a), { title: 'Hello' });
  expect(store.windows.value.find((w) => w.id === a)?.title).toBe('Hello');
  expect(store.windows.value.find((w) => w.id === b)?.title).toBe('t');
});

test('window.setSize is content size, converted to window size and clamped by min size', async () => {
  const { store, open, ctxFor } = windows();
  const a = open(APP);
  const h = windowHandlers(store)['window.setSize'];
  await h?.(ctxFor(APP, a), { width: 500, height: 400 });
  let w = store.windows.value.find((x) => x.id === a);
  expect([w?.w, w?.h]).toEqual([500 + CHROME_W, 400 + CHROME_H]);
  await h?.(ctxFor(APP, a), { width: 10, height: 10 });
  w = store.windows.value.find((x) => x.id === a);
  expect([w?.w, w?.h]).toEqual([200, 150]);
});

test('window.focus focuses and raises the caller window', async () => {
  const { store, open, ctxFor } = windows();
  const a = open(APP);
  const b = open('org.y.app');
  store.update(a, { shown: true }); // only a shown (app.ready) window may take focus
  expect(store.focusedId.value).toBe(b);
  await windowHandlers(store)['window.focus']?.(ctxFor(APP, a), {});
  expect(store.focusedId.value).toBe(a);
  const z = (id: string) => store.windows.value.find((w) => w.id === id)?.z ?? 0;
  expect(z(a)).toBeGreaterThan(z(b));
});

test('window.minimize minimizes the caller window', async () => {
  const { store, open, ctxFor } = windows();
  const a = open(APP);
  await windowHandlers(store)['window.minimize']?.(ctxFor(APP, a), {});
  expect(store.windows.value.find((w) => w.id === a)?.state).toBe('minimized');
});

test('window.close uses onClose with the instance id when provided, else closes the window', async () => {
  const { store, open, ctxFor } = windows();
  const a = open(APP);
  const onClose = vi.fn();
  await windowHandlers(store, { onClose })['window.close']?.(ctxFor(APP, a), {});
  expect(onClose).toHaveBeenCalledWith(`inst-${APP}`);
  expect(store.windows.value).toHaveLength(1);
  await windowHandlers(store)['window.close']?.(ctxFor(APP, a), {});
  expect(store.windows.value).toHaveLength(0);
});

async function fsSetup() {
  const fs = await createIdbFs(`methods-fs-${n++}`);
  await ensureHome(fs);
  const grants = await createGrantTable(createMemoryKv());
  const svc = createFsService(fs, grants);
  const { ctxFor } = windows();
  return { fs, grants, h: fsHandlers(svc), ctx: ctxFor(APP, 'w') };
}

test('fs.writeText then fs.readText round-trips on /apps/self', async () => {
  const { h, ctx } = await fsSetup();
  expect(await h['fs.writeText']?.(ctx, { ref: '/apps/self/a.txt', text: 'hi there' })).toBeNull();
  expect(await h['fs.readText']?.(ctx, { ref: '/apps/self/a.txt' })).toBe('hi there');
});

test('fs.read returns a Blob', async () => {
  const { h, ctx } = await fsSetup();
  await h['fs.writeText']?.(ctx, { ref: '/apps/self/a.txt', text: 'abc' });
  const blob = await h['fs.read']?.(ctx, { ref: '/apps/self/a.txt' });
  expect(blob).toBeInstanceOf(Blob);
  expect((blob as Blob).size).toBe(3);
});

test('fs errors keep their code but never leak the real path or the caller ref', async () => {
  const { h, ctx, fs, grants } = await fsSetup();
  await fs.write('/home/user/Documents/private-name.txt', new Blob(['x']));
  const g = grants.issue(APP, '/home/user/Documents/private-name.txt');
  expect(await h['fs.readText']?.(ctx, { ref: g.id })).toBe('x');
  await fs.remove('/home/user/Documents/private-name.txt');
  const err = await h['fs.readText']?.(ctx, { ref: g.id }).catch((e: unknown) => e);
  expect(err).toBeInstanceOf(EwError);
  expect((err as EwError).code).toBe('ENOENT');
  expect((err as EwError).message).not.toContain('/home');
  expect((err as EwError).message).not.toContain('private-name');
  expect((err as EwError).message).not.toContain(g.id);
});

test('theme.get returns the theme tokens', async () => {
  const { ctxFor } = windows();
  const r = await themeHandlers(() => glass)['theme.get']?.(ctxFor(APP, 'w'), {});
  expect(r).toEqual({ tokens: glass.tokens });
});

const zOf = (store: ReturnType<typeof windows>['store'], id: string) =>
  store.windows.value.find((w) => w.id === id)?.z;

test('window.focus on the already focused window does not bump z, even 1000 times', async () => {
  const { store, open, ctxFor } = windows();
  const a = open(APP);
  const z = zOf(store, a);
  const h = windowHandlers(store)['window.focus'];
  for (let i = 0; i < 1000; i++) await h?.(ctxFor(APP, a), {});
  expect(zOf(store, a)).toBe(z);
});

test('window.focus on a minimized window is a no-op', async () => {
  const { store, open, ctxFor } = windows();
  const a = open(APP);
  const b = open('org.y.app');
  store.minimize(a);
  await windowHandlers(store)['window.focus']?.(ctxFor(APP, a), {});
  expect(store.windows.value.find((w) => w.id === a)?.state).toBe('minimized');
  expect(store.focusedId.value).toBe(b);
});

test('window.setSize clamps the window to the viewport above the taskbar when given a viewport', async () => {
  const { store, open, ctxFor } = windows();
  const a = open(APP);
  const h = windowHandlers(store, { getViewport: () => ({ width: 1200, height: 800 }) })['window.setSize'];
  await h?.(ctxFor(APP, a), { width: 1e8, height: 1e8 });
  const w = store.windows.value.find((x) => x.id === a);
  expect(w?.w).toBeLessThanOrEqual(1200);
  expect(w?.h).toBeLessThanOrEqual(800 - TASKBAR_H);
  await h?.(ctxFor(APP, a), { width: 500, height: 400 });
  const w2 = store.windows.value.find((x) => x.id === a);
  expect([w2?.w, w2?.h]).toEqual([500 + CHROME_W, 400 + CHROME_H]);
});

test('window.setTitle strips control and bidi override characters; empty result is ignored', async () => {
  const { store, open, ctxFor } = windows();
  const a = open(APP);
  const h = windowHandlers(store)['window.setTitle'];
  await h?.(ctxFor(APP, a), { title: ' Evil\n\u202Etxt.exe\u2066 ' });
  expect(store.windows.value.find((w) => w.id === a)?.title).toBe('Eviltxt.exe');
  await h?.(ctxFor(APP, a), { title: '\n\u202E ' });
  expect(store.windows.value.find((w) => w.id === a)?.title).toBe('Eviltxt.exe');
});

test('window.focus on a window that is not yet shown is a no-op', async () => {
  const { store, open, ctxFor } = windows();
  const a = open(APP);
  const b = open('org.y.app');
  const z = zOf(store, a);
  await windowHandlers(store)['window.focus']?.(ctxFor(APP, a), {});
  expect(store.focusedId.value).toBe(b);
  expect(zOf(store, a)).toBe(z);
});
