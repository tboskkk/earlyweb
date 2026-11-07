import { signal } from '@preact/signals';
import { expect, test } from 'vitest';
import { createWindowStore, MIN_VISIBLE, TASKBAR_H, TITLEBAR_H } from '../src/state/windows.ts';

const base = {
  appId: 'app',
  instanceId: 'i',
  title: 't',
  icon: 'ic',
  w: 300,
  h: 200,
  minW: 100,
  minH: 80,
  resizable: true,
};

function setup(width = 1000, height = 700) {
  const viewport = signal({ width, height });
  const store = createWindowStore(viewport);
  const get = (id: string) => {
    const w = store.windows.value.find((x) => x.id === id);
    if (!w) throw new Error(`no window ${id}`);
    return w;
  };
  return { viewport, store, get };
}

test('open cascades at 40 + 24 * (n % 10), focuses, and takes the highest z', () => {
  const { store, get } = setup();
  const ids: string[] = [];
  for (let n = 0; n < 12; n++) {
    ids.push(store.open(base));
    const w = get(ids[n] as string);
    const off = 40 + 24 * (n % 10);
    expect([w.x, w.y, w.w, w.h]).toEqual([off, off, 300, 200]);
    expect(store.focusedId.value).toBe(ids[n]);
    expect(w.z).toBe(Math.max(...store.windows.value.map((x) => x.z)));
    expect(w.state).toBe('normal');
  }
  expect(new Set(ids).size).toBe(12);
  expect(get(ids[10] as string).x).toBe(40);
});

test('open honours a partial rect override', () => {
  const { store, get } = setup();
  const id = store.open({ ...base, rect: { x: 5, y: 6 } });
  expect([get(id).x, get(id).y, get(id).w]).toEqual([5, 6, 300]);
});

test('focus raises a window above the others', () => {
  const { store, get } = setup();
  const a = store.open(base);
  const b = store.open(base);
  expect(get(a).z).toBeLessThan(get(b).z);
  store.focus(a);
  expect(store.focusedId.value).toBe(a);
  expect(get(a).z).toBeGreaterThan(get(b).z);
});

test('minimize of the focused window focuses the highest-z non-minimized window, or null', () => {
  const { store, get } = setup();
  const a = store.open(base);
  const b = store.open(base);
  const c = store.open(base);
  store.minimize(c);
  expect(get(c).state).toBe('minimized');
  expect(store.focusedId.value).toBe(b);
  store.minimize(b);
  expect(store.focusedId.value).toBe(a);
  store.minimize(a);
  expect(store.focusedId.value).toBeNull();
});

test('minimize of an unfocused window leaves focus alone', () => {
  const { store } = setup();
  const a = store.open(base);
  const b = store.open(base);
  store.minimize(a);
  expect(store.focusedId.value).toBe(b);
});

test('restore un-minimizes and focuses', () => {
  const { store, get } = setup();
  const a = store.open(base);
  const b = store.open(base);
  store.minimize(a);
  store.restore(a);
  expect(get(a).state).toBe('normal');
  expect(store.focusedId.value).toBe(a);
  expect(get(a).z).toBeGreaterThan(get(b).z);
});

test('move clamps y and x so the title bar stays reachable', () => {
  const { store, get } = setup(1000, 700);
  const id = store.open(base);
  store.move(id, -5000, -5000);
  expect([get(id).x, get(id).y]).toEqual([MIN_VISIBLE - 300, 0]);
  store.move(id, 5000, 5000);
  expect([get(id).x, get(id).y]).toEqual([1000 - MIN_VISIBLE, 700 - TASKBAR_H - TITLEBAR_H]);
  store.move(id, 100, 120);
  expect([get(id).x, get(id).y]).toEqual([100, 120]);
});

test('shrinking the viewport re-clamps every window', () => {
  const { store, viewport, get } = setup(1000, 700);
  const a = store.open({ ...base, rect: { x: 900, y: 600 } });
  const b = store.open({ ...base, rect: { x: 50, y: 50 } });
  viewport.value = { width: 500, height: 300 };
  expect([get(a).x, get(a).y]).toEqual([500 - MIN_VISIBLE, 300 - TASKBAR_H - TITLEBAR_H]);
  expect([get(b).x, get(b).y]).toEqual([50, 50]);
});

test('shrinking the viewport re-fits maximized windows', () => {
  const { store, viewport, get } = setup(1000, 700);
  const a = store.open(base);
  store.toggleMaximize(a);
  viewport.value = { width: 800, height: 500 };
  expect([get(a).x, get(a).y, get(a).w, get(a).h]).toEqual([0, 0, 800, 500 - TASKBAR_H]);
});

test('resize never goes below minW/minH', () => {
  const { store, get } = setup();
  const id = store.open(base);
  store.resize(id, { x: 10, y: 20, w: 5, h: 5 });
  expect([get(id).x, get(id).y, get(id).w, get(id).h]).toEqual([10, 20, 100, 80]);
  store.resize(id, { x: 10, y: 20, w: 400, h: 300 });
  expect([get(id).w, get(id).h]).toEqual([400, 300]);
});

test('a non-resizable window ignores resize', () => {
  const { store, get } = setup();
  const id = store.open({ ...base, resizable: false });
  store.resize(id, { x: 1, y: 2, w: 500, h: 500 });
  expect([get(id).x, get(id).y, get(id).w, get(id).h]).toEqual([40, 40, 300, 200]);
});

test('toggleMaximize fills the viewport above the taskbar and restores the exact rect', () => {
  const { store, get } = setup(1000, 700);
  const id = store.open({ ...base, rect: { x: 123, y: 77 } });
  store.toggleMaximize(id);
  const m = get(id);
  expect([m.x, m.y, m.w, m.h, m.state]).toEqual([0, 0, 1000, 700 - TASKBAR_H, 'maximized']);
  expect(m.restoreRect).toEqual({ x: 123, y: 77, w: 300, h: 200 });
  store.toggleMaximize(id);
  const r = get(id);
  expect([r.x, r.y, r.w, r.h, r.state]).toEqual([123, 77, 300, 200, 'normal']);
  expect(r.restoreRect).toBeUndefined();
});

test('close removes the window and refocuses the next one', () => {
  const { store } = setup();
  const a = store.open(base);
  const b = store.open(base);
  const c = store.open(base);
  store.minimize(b);
  store.close(c);
  expect(store.windows.value.map((w) => w.id)).toEqual([a, b]);
  expect(store.focusedId.value).toBe(a);
  store.close(a);
  expect(store.focusedId.value).toBeNull();
});

test('closing an unfocused window keeps focus', () => {
  const { store } = setup();
  const a = store.open(base);
  const b = store.open(base);
  store.close(a);
  expect(store.focusedId.value).toBe(b);
});

test('update merges a patch', () => {
  const { store, get } = setup();
  const id = store.open(base);
  store.update(id, { title: 'new', shown: true, notResponding: true });
  expect([get(id).title, get(id).shown, get(id).notResponding]).toEqual(['new', true, true]);
});

test('un-maximize after a viewport shrink restores a reachable rect', () => {
  const { store, viewport, get } = setup(1000, 700);
  const id = store.open({ ...base, rect: { x: 900, y: 600 } });
  store.toggleMaximize(id);
  viewport.value = { width: 500, height: 300 };
  store.toggleMaximize(id);
  expect([get(id).x, get(id).y, get(id).w, get(id).h]).toEqual([420, 230, 300, 200]);
});

test('focus fallback after minimize uses z order, not array order', () => {
  const { store } = setup();
  const a = store.open(base);
  store.open(base);
  const c = store.open(base);
  store.focus(a);
  store.focus(c);
  store.minimize(c);
  expect(store.focusedId.value).toBe(a);
});

test('close fallback uses z order too', () => {
  const { store } = setup();
  const a = store.open(base);
  store.open(base);
  const c = store.open(base);
  store.focus(a);
  store.focus(c);
  store.close(c);
  expect(store.focusedId.value).toBe(a);
});

test('resize clamps position using the new width', () => {
  const { store, get } = setup(1000, 700);
  const id = store.open(base);
  store.resize(id, { x: -5000, y: 5000, w: 400, h: 300 });
  expect([get(id).x, get(id).y, get(id).w, get(id).h]).toEqual([
    MIN_VISIBLE - 400,
    700 - TASKBAR_H - TITLEBAR_H,
    400,
    300,
  ]);
});

test('restoring a minimized maximized window after a shrink re-fits it', () => {
  const { store, viewport, get } = setup(1000, 700);
  const id = store.open({ ...base, rect: { x: 900, y: 600 } });
  store.toggleMaximize(id);
  store.minimize(id);
  viewport.value = { width: 500, height: 300 };
  store.restore(id);
  expect([get(id).x, get(id).y, get(id).w, get(id).h, get(id).state]).toEqual([0, 0, 500, 260, 'maximized']);
  store.toggleMaximize(id);
  expect([get(id).x, get(id).y, get(id).state]).toEqual([420, 230, 'normal']);
});

test('toggleMaximize on a minimized window restores it first and keeps the original restoreRect', () => {
  const { store, get } = setup(1000, 700);
  const id = store.open({ ...base, rect: { x: 123, y: 77 } });
  store.minimize(id);
  store.toggleMaximize(id);
  expect([get(id).state, get(id).restoreRect]).toEqual(['maximized', { x: 123, y: 77, w: 300, h: 200 }]);
  store.toggleMaximize(id);
  expect([get(id).x, get(id).y, get(id).w, get(id).h, get(id).state]).toEqual([123, 77, 300, 200, 'normal']);
});

test('toggleMaximize on a minimized-from-maximized window returns it to normal', () => {
  const { store, get } = setup(1000, 700);
  const id = store.open({ ...base, rect: { x: 123, y: 77 } });
  store.toggleMaximize(id);
  store.minimize(id);
  store.toggleMaximize(id);
  expect([get(id).x, get(id).y, get(id).state, get(id).restoreRect]).toEqual([123, 77, 'normal', undefined]);
});

test('move and resize on a maximized window are ignored', () => {
  const { store, get } = setup(1000, 700);
  const id = store.open(base);
  store.toggleMaximize(id);
  store.move(id, 50, 50);
  store.resize(id, { x: 5, y: 5, w: 200, h: 200 });
  expect([get(id).x, get(id).y, get(id).w, get(id).h]).toEqual([0, 0, 1000, 660]);
});

test('focus on a minimized window restores it', () => {
  const { store, get } = setup();
  const a = store.open(base);
  const b = store.open(base);
  store.minimize(a);
  store.focus(a);
  expect(get(a).state).toBe('normal');
  expect(store.focusedId.value).toBe(a);
  expect(get(a).z).toBeGreaterThan(get(b).z);
});

test('close of an unknown id does not touch the windows array', () => {
  const { store } = setup();
  store.open(base);
  const before = store.windows.value;
  store.close('nope');
  expect(store.windows.value).toBe(before);
});

test('z is renumbered once it passes 10000: stays <= 10000 and order is preserved', () => {
  const { store, get } = setup();
  const a = store.open(base);
  const b = store.open(base);
  const c = store.open(base);
  for (let i = 0; i < 25000; i++) {
    store.focus(i % 2 ? a : b);
    expect(Math.max(get(a).z, get(b).z, get(c).z)).toBeLessThanOrEqual(10000);
  }
  // last focus was a (i = 24999), before that b; c was never raised again
  expect(get(a).z).toBeGreaterThan(get(b).z);
  expect(get(b).z).toBeGreaterThan(get(c).z);
  store.focus(c);
  expect(get(c).z).toBeGreaterThan(get(a).z);
  expect(new Set([a, b, c].map((id) => get(id).z)).size).toBe(3);
});
