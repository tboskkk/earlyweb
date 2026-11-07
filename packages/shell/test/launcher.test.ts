import type { Manifest } from '@earlyweb/protocol';
import { signal } from '@preact/signals';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Broker, Connection } from '../src/broker/broker.ts';
import type { Handshake } from '../src/host/handshake.ts';
import { createLauncher } from '../src/host/launcher.ts';
import type { CatalogEntry } from '../src/state/catalog.ts';
import { createWindowStore } from '../src/state/windows.ts';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const manifest = (id: string, single = false): Manifest =>
  ({
    id,
    name: `Name ${id}`,
    entry: 'index.html',
    icons: { '16': 'i16.png' },
    permissions: [],
    window: {
      width: 500,
      height: 400,
      minWidth: 100,
      minHeight: 90,
      resizable: false,
      singleInstance: single,
    },
  }) as unknown as Manifest;

type FakeConn = Connection & {
  request: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
  detach: ReturnType<typeof vi.fn>;
};

function setup() {
  const store = createWindowStore(signal({ width: 1200, height: 800 }));
  const catalog = signal<CatalogEntry[]>([
    { manifest: manifest('a.b.one'), baseUrl: 'http://apps.test/one/' },
    { manifest: manifest('a.b.single', true), baseUrl: 'http://apps.test/single/' },
  ]);
  const handshake = { register: vi.fn(), unregister: vi.fn() } satisfies Handshake;
  const conns: FakeConn[] = [];
  const broker: Broker = {
    attach: vi.fn(() => {
      const c = {
        request: vi.fn((name: string, _d?: unknown, t?: number) =>
          name === 'ping'
            ? Promise.resolve(true)
            : new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), t)),
        ),
        emit: vi.fn(),
        detach: vi.fn(),
        droppedCount: () => 0,
      } as unknown as FakeConn;
      conns.push(c);
      return c;
    }),
  };
  const launcher = createLauncher({ store, catalog, handshake, broker });
  const win = (id: string) => store.windows.value.find((w) => w.id === id);
  const port = () => ({ close: vi.fn(), postMessage: vi.fn(), addEventListener: vi.fn(), start: vi.fn() });
  const connect = (instanceId: string) => {
    const e = launcher.instances.value.get(instanceId);
    if (!e) throw new Error('no instance');
    const p = port();
    launcher.connect(e.instance, p);
    return p;
  };
  return { store, launcher, handshake, broker, conns, win, port, connect };
}

test('launch opens a hidden window from the manifest and records the instance', () => {
  const { launcher, store } = setup();
  const id = launcher.launch('a.b.one');
  const e = launcher.instances.value.get(id);
  expect(e?.instance.appId).toBe('a.b.one');
  const w = store.windows.value.find((x) => x.id === e?.instance.windowId);
  expect(w).toMatchObject({
    title: 'Name a.b.one',
    icon: 'http://apps.test/one/i16.png',
    w: 500,
    h: 400,
    minW: 100,
    minH: 90,
    resizable: false,
    shown: false,
    notResponding: false,
  });
  expect(() => launcher.launch('nope.nope.nope')).toThrow();
});

test('close() with an unresponsive app: timeout -> notResponding true and the window is kept', async () => {
  const { launcher, win, connect, conns } = setup();
  const id = launcher.launch('a.b.one');
  connect(id);
  const wid = launcher.instances.value.get(id)?.instance.windowId as string;
  const p = launcher.close(id);
  await vi.advanceTimersByTimeAsync(10000);
  await p;
  expect(win(wid)?.notResponding).toBe(true);
  expect(launcher.instances.value.has(id)).toBe(true);
  expect(conns[0]?.detach).not.toHaveBeenCalled();
});

test('close() with a cancel answer leaves everything untouched', async () => {
  const { launcher, win, connect, conns, handshake } = setup();
  const id = launcher.launch('a.b.one');
  launcher.attachFrame(id, {});
  connect(id);
  const wid = launcher.instances.value.get(id)?.instance.windowId as string;
  conns[0]?.request.mockImplementation((name: string) => Promise.resolve(name !== 'beforeClose'));
  const before = launcher.instances.value;
  await launcher.close(id);
  expect(launcher.instances.value).toBe(before);
  expect(win(wid)).toBeDefined();
  expect(win(wid)?.notResponding).toBe(false);
  expect(conns[0]?.detach).not.toHaveBeenCalled();
  expect(handshake.unregister).not.toHaveBeenCalled();
});

test('close() with a close answer removes the instance and the window', async () => {
  const { launcher, win, connect, conns } = setup();
  const id = launcher.launch('a.b.one');
  connect(id);
  const wid = launcher.instances.value.get(id)?.instance.windowId as string;
  conns[0]?.request.mockImplementation(() => Promise.resolve(true));
  await launcher.close(id);
  expect(launcher.instances.value.has(id)).toBe(false);
  expect(win(wid)).toBeUndefined();
  expect(conns[0]?.detach).toHaveBeenCalledTimes(1);
});

test('close() with no connection ends the task immediately', async () => {
  const { launcher, win } = setup();
  const id = launcher.launch('a.b.one');
  const wid = launcher.instances.value.get(id)?.instance.windowId as string;
  await launcher.close(id);
  expect(launcher.instances.value.has(id)).toBe(false);
  expect(win(wid)).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0);
});

test('endTask stops the watchdog, unregisters the frame, detaches, clears the fallback and removes everything', () => {
  const { launcher, win, connect, conns, handshake } = setup();
  const id = launcher.launch('a.b.one');
  const frame = {};
  launcher.attachFrame(id, frame);
  expect(handshake.register).toHaveBeenCalledTimes(1);
  connect(id);
  const wid = launcher.instances.value.get(id)?.instance.windowId as string;
  launcher.endTask(id);
  expect(handshake.unregister).toHaveBeenCalledWith(frame);
  expect(conns[0]?.detach).toHaveBeenCalledTimes(1);
  expect(launcher.instances.value.has(id)).toBe(false);
  expect(win(wid)).toBeUndefined();
  expect(vi.getTimerCount()).toBe(0); // fallback timer and watchdog interval both gone
  vi.advanceTimersByTime(60000);
  expect(conns[0]?.request).not.toHaveBeenCalled();
  launcher.endTask(id); // idempotent
  expect(conns[0]?.detach).toHaveBeenCalledTimes(1);
});

test('endTask during an in-flight close() leaves nothing behind and the late outcome is a no-op', async () => {
  const { launcher, win, connect, conns } = setup();
  const id = launcher.launch('a.b.one');
  connect(id);
  const wid = launcher.instances.value.get(id)?.instance.windowId as string;
  const p = launcher.close(id);
  launcher.endTask(id);
  await vi.advanceTimersByTimeAsync(10000); // beforeClose now times out
  await p;
  expect(launcher.instances.value.has(id)).toBe(false);
  expect(win(wid)).toBeUndefined();
  expect(conns[0]?.detach).toHaveBeenCalledTimes(1);
});

test('singleInstance relaunch focuses the existing window, emits file.open, and opens no second window', () => {
  const { launcher, store, connect, conns } = setup();
  const id1 = launcher.launch('a.b.single');
  connect(id1);
  const other = launcher.launch('a.b.one');
  const wid1 = launcher.instances.value.get(id1)?.instance.windowId as string;
  expect(store.focusedId.value).not.toBe(wid1);
  const file = { id: 'f1', name: 'f.txt' };
  const id2 = launcher.launch('a.b.single', { args: [], file });
  expect(id2).toBe(id1);
  expect(store.windows.value).toHaveLength(2);
  expect(launcher.instances.value.size).toBe(2);
  expect(conns[0]?.emit).toHaveBeenCalledWith('file.open', { file });
  expect(store.focusedId.value).toBe(wid1);
  launcher.launch('a.b.single'); // no file -> no event
  expect(conns[0]?.emit).toHaveBeenCalledTimes(1);
  expect(other).not.toBe(id1);
});

test('the 3 s fallback sets shown:true; ready() shows immediately and clears the fallback', () => {
  const { launcher, win } = setup();
  const a = launcher.launch('a.b.one');
  const wa = launcher.instances.value.get(a)?.instance.windowId as string;
  vi.advanceTimersByTime(2999);
  expect(win(wa)?.shown).toBe(false);
  vi.advanceTimersByTime(1);
  expect(win(wa)?.shown).toBe(true);

  const b = launcher.launch('a.b.one');
  const wb = launcher.instances.value.get(b)?.instance.windowId as string;
  launcher.ready(b);
  expect(win(wb)?.shown).toBe(true);
  expect(vi.getTimerCount()).toBe(0);
});

test('connect() for an unknown or ended instance closes the port and attaches nothing', () => {
  const { launcher, broker, port } = setup();
  const id = launcher.launch('a.b.one');
  const instance = launcher.instances.value.get(id)?.instance;
  if (!instance) throw new Error('no instance');
  launcher.endTask(id);
  const p = port();
  launcher.connect(instance, p);
  expect(p.close).toHaveBeenCalledTimes(1);
  const p2 = port();
  launcher.connect({ ...instance, instanceId: 'never-existed' }, p2);
  expect(p2.close).toHaveBeenCalledTimes(1);
  expect(broker.attach).not.toHaveBeenCalled();
});

test('a second connect() closes the new port and leaves the first connection attached', () => {
  const { launcher, broker, conns, connect } = setup();
  const id = launcher.launch('a.b.one');
  const p1 = connect(id);
  const p2 = connect(id);
  expect(p2.close).toHaveBeenCalledTimes(1);
  expect(p1.close).not.toHaveBeenCalled();
  expect(broker.attach).toHaveBeenCalledTimes(1);
  expect(launcher.instances.value.get(id)?.conn).toBe(conns[0]);
  expect(conns[0]?.detach).not.toHaveBeenCalled();
});

test('attachFrame with the same window is a no-op; null only unregisters and keeps the live connection', () => {
  const { launcher, handshake, conns, connect } = setup();
  const id = launcher.launch('a.b.one');
  const frame = {};
  launcher.attachFrame(id, frame);
  connect(id);
  launcher.attachFrame(id, frame);
  expect(handshake.register).toHaveBeenCalledTimes(1);
  expect(handshake.unregister).not.toHaveBeenCalled();
  launcher.attachFrame(id, null);
  expect(handshake.unregister).toHaveBeenCalledWith(frame);
  expect(conns[0]?.detach).not.toHaveBeenCalled();
  expect(launcher.instances.value.has(id)).toBe(true);
});

test('instances is replaced immutably on every change', () => {
  const { launcher, connect } = setup();
  const m0 = launcher.instances.value;
  const id = launcher.launch('a.b.one');
  const m1 = launcher.instances.value;
  expect(m1).not.toBe(m0);
  expect(m0.size).toBe(0);
  connect(id);
  const m2 = launcher.instances.value;
  expect(m2).not.toBe(m1);
  expect(m1.get(id)?.conn).toBeUndefined();
  expect(m2.get(id)?.conn).toBeDefined();
  launcher.endTask(id);
  expect(launcher.instances.value).not.toBe(m2);
  expect(m2.has(id)).toBe(true);
});

test('watchdog not-responding changes reach the window', async () => {
  const { launcher, win, connect, conns } = setup();
  const id = launcher.launch('a.b.one');
  connect(id);
  const wid = launcher.instances.value.get(id)?.instance.windowId as string;
  conns[0]?.request.mockImplementation(() => Promise.reject(new Error('timeout')));
  await vi.advanceTimersByTimeAsync(3000);
  expect(win(wid)?.notResponding).toBe(true);
});
