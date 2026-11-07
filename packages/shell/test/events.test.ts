import { signal } from '@preact/signals';
import { expect, test, vi } from 'vitest';
import { focusWindowOfActiveFrame, forwardWindowEvents } from '../src/host/events.ts';
import { CHROME_H, CHROME_W } from '../src/state/content-size.ts';
import { createWindowStore } from '../src/state/windows.ts';

function setup() {
  const store = createWindowStore(signal({ width: 1200, height: 800 }));
  // Keyed by app name so a connection exists before its window does (as emit targets are looked up lazily).
  const emits = new Map<string, { emit: ReturnType<typeof vi.fn> }>();
  const conns = {
    get: (windowId: string) => {
      const name = store.windows.peek().find((w) => w.id === windowId)?.appId ?? windowId;
      if (!emits.has(name)) emits.set(name, { emit: vi.fn() });
      return emits.get(name);
    },
  };
  const open = (name: string) => {
    const id = store.open({
      appId: name,
      instanceId: name,
      title: name,
      icon: '',
      w: 400,
      h: 300,
      minW: 200,
      minH: 150,
      resizable: true,
    });
    return id;
  };
  return { store, conns, open };
}

test('focus change emits blur to the previous and focus to the new window', () => {
  const { store, conns, open } = setup();
  const a = open('a');
  const stop = forwardWindowEvents(store, (id) => conns.get(id) as never);
  expect(conns.get(a)?.emit).toHaveBeenCalledWith('focus', null);
  const b = open('b');
  expect(conns.get(a)?.emit).toHaveBeenLastCalledWith('blur', null);
  expect(conns.get(b)?.emit).toHaveBeenCalledWith('focus', null);
  store.focus(a);
  expect(conns.get(b)?.emit).toHaveBeenLastCalledWith('blur', null);
  expect(conns.get(a)?.emit).toHaveBeenLastCalledWith('focus', null);
  stop();
});

test('resize emits content size (window size minus chrome), not on first sight or other changes', () => {
  const { store, conns, open } = setup();
  const a = open('a');
  const stop = forwardWindowEvents(store, (id) => conns.get(id) as never);
  const emit = conns.get(a)?.emit;
  expect(emit?.mock.calls.filter((c) => c[0] === 'resize')).toHaveLength(0);
  store.resize(a, { x: 50, y: 50, w: 600, h: 500 });
  expect(emit).toHaveBeenLastCalledWith('resize', { width: 600 - CHROME_W, height: 500 - CHROME_H });
  const n = emit?.mock.calls.length;
  store.update(a, { title: 'x' });
  expect(emit?.mock.calls.length).toBe(n);
  stop();
});

test('window blur fallback focuses the window owning the active iframe', () => {
  const { store, open } = setup();
  const a = open('a');
  open('b');
  const frame = {};
  focusWindowOfActiveFrame(store, { contentWindow: frame }, (f) => (f === frame ? a : undefined));
  expect(store.focusedId.value).toBe(a);
  focusWindowOfActiveFrame(store, null, () => 'zzz');
  focusWindowOfActiveFrame(store, { contentWindow: {} }, () => undefined);
  expect(store.focusedId.value).toBe(a);
});
