import { createMemoryKv } from '@earlyweb/backends';
import type { LaunchArgs } from '@earlyweb/protocol';
import { signal } from '@preact/signals';
import { expect, test, vi } from 'vitest';
import type { InstanceEntry, Launcher } from '../src/host/launcher.ts';
import type { CatalogEntry } from '../src/state/catalog.ts';
import {
  loadSession,
  restoreSession,
  type SessionRecord,
  saveSession,
  snapshot,
} from '../src/state/session.ts';
import { createWindowStore, type Rect } from '../src/state/windows.ts';

const vp = () => signal({ width: 1000, height: 800 });
const rec = (appId: string, over: Partial<SessionRecord> = {}): SessionRecord => ({
  appId,
  rect: { x: 50, y: 60, w: 300, h: 200 },
  state: 'normal',
  launch: { args: [] },
  ...over,
});

test('save/load round-trips exactly', async () => {
  const kv = createMemoryKv();
  const records = [
    rec('a'),
    rec('b', { state: 'maximized', launch: { args: ['x'], file: { id: 'g1', name: 'f.txt' } } }),
  ];
  await saveSession(kv, records);
  expect(await loadSession(kv)).toEqual(records);
});

test('missing or wholly malformed value gives []', async () => {
  const kv = createMemoryKv();
  expect(await loadSession(kv)).toEqual([]);
  for (const bad of ['nope', 42, { a: 1 }, null]) {
    await kv.set('session', bad);
    expect(await loadSession(kv)).toEqual([]);
  }
});

test('an array with some malformed records keeps only the valid ones', async () => {
  const kv = createMemoryKv();
  await kv.set('session', [rec('a'), { appId: 5 }, rec('b', { state: 'bogus' as never }), rec('c')]);
  expect((await loadSession(kv)).map((r) => r.appId)).toEqual(['a', 'c']);
});

function fakes() {
  const store = createWindowStore(vp());
  const launch = vi.fn((appId: string, l?: LaunchArgs, rect?: Partial<Rect>) => {
    const windowId = store.open({
      appId,
      instanceId: `i-${appId}`,
      title: appId,
      icon: '',
      w: 400,
      h: 300,
      minW: 50,
      minH: 50,
      resizable: true,
      rect,
    });
    void l;
    return `i-${appId}:${windowId}`;
  });
  const instances = signal(new Map<string, InstanceEntry>());
  const launcher = { launch, instances } as unknown as Launcher;
  return { store, launch, launcher, instances };
}
const cat = (...ids: string[]) => signal(ids.map((id) => ({ manifest: { id } }) as unknown as CatalogEntry));

test('restore launches known apps, applies state, skips unknown', () => {
  const { store, launch, launcher, instances } = fakes();
  // make launch register the instance so restore can find the window
  launch.mockImplementation((appId, _l, rect) => {
    const windowId = store.open({
      appId,
      instanceId: `i-${appId}`,
      title: appId,
      icon: '',
      w: 400,
      h: 300,
      minW: 50,
      minH: 50,
      resizable: true,
      rect,
    });
    instances.value = new Map(instances.value).set(`i-${appId}`, {
      instance: { windowId },
    } as unknown as InstanceEntry);
    return `i-${appId}`;
  });
  const records = [
    rec('a'),
    rec('ghost'),
    rec('b', { state: 'minimized' }),
    rec('c', { state: 'maximized', launch: { args: [], file: { id: 'g', name: 'n' } } }),
  ];
  restoreSession(records, launcher, cat('a', 'b', 'c'), store);
  expect(launch).toHaveBeenCalledTimes(3);
  expect(launch).toHaveBeenCalledWith('a', records[0]?.launch, records[0]?.rect);
  expect(launch).toHaveBeenCalledWith('c', records[3]?.launch, records[3]?.rect);
  const by = (a: string) => store.windows.value.find((w) => w.appId === a);
  expect(by('a')?.state).toBe('normal');
  expect(by('b')?.state).toBe('minimized');
  expect(by('c')?.state).toBe('maximized');
  expect(by('c')?.restoreRect).toMatchObject({ x: 50, y: 60, w: 300, h: 200 });
});

test('garbage file id and extreme rect do not crash; rect is clamped', () => {
  const { store, launch, launcher, instances } = fakes();
  launch.mockImplementation((appId, _l, rect) => {
    const windowId = store.open({
      appId,
      instanceId: 'i',
      title: appId,
      icon: '',
      w: 400,
      h: 300,
      minW: 50,
      minH: 50,
      resizable: true,
      rect,
    });
    instances.value = new Map(instances.value).set('i', {
      instance: { windowId },
    } as unknown as InstanceEntry);
    return 'i';
  });
  restoreSession(
    [
      rec('a', {
        rect: { x: 1e9, y: -1e9, w: 300, h: 200 },
        launch: { args: [], file: { id: '../../x', name: 'z' } },
      }),
    ],
    launcher,
    cat('a'),
    store,
  );
  const w = store.windows.value[0];
  expect(w?.x).toBeLessThanOrEqual(1000 - 80);
  expect(w?.y).toBeGreaterThanOrEqual(0);
});

test('restore is capped at 20 windows', () => {
  const { store, launch, launcher } = fakes();
  restoreSession(
    Array.from({ length: 30 }, () => rec('a')),
    launcher,
    cat('a'),
    store,
  );
  expect(launch).toHaveBeenCalledTimes(20);
});

test('snapshot: z order, restoreRect for maximized, current launch', () => {
  const { store } = fakes();
  const open = (appId: string) =>
    store.open({
      appId,
      instanceId: `i-${appId}`,
      title: appId,
      icon: '',
      w: 300,
      h: 200,
      minW: 50,
      minH: 50,
      resizable: true,
      rect: { x: 10, y: 20 },
    });
  const wa = open('a');
  const wb = open('b');
  const wc = open('c');
  store.toggleMaximize(wb);
  store.minimize(wc);
  store.focus(wa); // a now on top
  const instances = signal(new Map<string, InstanceEntry>());
  const mk = (appId: string, windowId: string, launch: LaunchArgs) =>
    [`i-${appId}`, { instance: { windowId, appId, launch } } as unknown as InstanceEntry] as const;
  instances.value = new Map([
    mk('a', wa, { args: [], file: { id: 'g2', name: 'Hello 2006' } }),
    mk('b', wb, { args: [] }),
    mk('c', wc, { args: [] }),
  ]);
  const snap = snapshot(store, instances);
  expect(snap.map((r) => r.appId)).toEqual(['b', 'c', 'a']);
  expect(snap[0]).toEqual({
    appId: 'b',
    rect: { x: 10, y: 20, w: 300, h: 200 },
    state: 'maximized',
    launch: { args: [] },
  });
  expect(snap[1]?.state).toBe('minimized');
  expect(snap[2]?.launch.file).toEqual({ id: 'g2', name: 'Hello 2006' });
});
