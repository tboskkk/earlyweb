import { EwError, type Manifest } from '@earlyweb/protocol';
import { afterEach, expect, test, vi } from 'vitest';
import { createBroker, type Handler } from '../src/broker/broker.ts';
import type { AppInstance } from '../src/host/handshake.ts';

const instance = (permissions: string[] = []): AppInstance => ({
  instanceId: 'i1',
  appId: 'a.b.c',
  manifest: { permissions } as unknown as Manifest,
  windowId: 'w1',
  launch: { args: [] },
});

function setup(
  opts: {
    handlers?: Record<string, Handler>;
    permissions?: string[];
    rate?: { max: number; windowMs: number };
  } = {},
) {
  const ch = new MessageChannel();
  const broker = createBroker({ handlers: opts.handlers ?? {}, rate: opts.rate });
  const conn = broker.attach(instance(opts.permissions), ch.port1 as never);
  const received: Record<string, unknown>[] = [];
  ch.port2.addEventListener('message', (e) => received.push(e.data as Record<string, unknown>));
  ch.port2.start();
  // Wait for real I/O to settle (works under fake timers when only setTimeout is faked).
  const settle = async () => {
    for (let n = 0; n < 5; n++) await new Promise<void>((r) => setImmediate(r));
  };
  const close = () => {
    conn.detach();
    ch.port2.close();
  };
  return { ch, conn, received, settle, close };
}

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
  vi.useRealTimers();
});
const track = <T extends { close(): void }>(s: T) => {
  cleanup = s.close;
  return s;
};

test('unknown method -> EUNSUPPORTED', async () => {
  const s = track(setup());
  s.ch.port2.postMessage({ t: 'call', id: 1, method: 'nope.nothing', params: {} });
  await s.settle();
  expect(s.received).toEqual([
    { t: 'result', id: 1, ok: false, error: { code: 'EUNSUPPORTED', message: expect.any(String) } },
  ]);
});

test('prototype-chain method names are unknown, not looked up', async () => {
  const s = track(setup());
  s.ch.port2.postMessage({ t: 'call', id: 1, method: 'constructor', params: {} });
  s.ch.port2.postMessage({ t: 'call', id: 2, method: '__proto__', params: {} });
  await s.settle();
  expect(s.received.map((r) => (r.error as { code: string }).code)).toEqual(['EUNSUPPORTED', 'EUNSUPPORTED']);
});

test('bad params -> EINVAL and the handler is not invoked', async () => {
  const handler = vi.fn(async () => null);
  const s = track(setup({ handlers: { 'window.setTitle': handler } }));
  s.ch.port2.postMessage({ t: 'call', id: 1, method: 'window.setTitle', params: { title: 5 } });
  await s.settle();
  expect(s.received).toHaveLength(1);
  expect(s.received[0]).toMatchObject({ t: 'result', id: 1, ok: false, error: { code: 'EINVAL' } });
  expect(handler).not.toHaveBeenCalled();
});

test('dialog.open without fs.dialog -> EPERM and the handler is not invoked', async () => {
  const handler = vi.fn(async () => null);
  const s = track(setup({ handlers: { 'dialog.open': handler } }));
  s.ch.port2.postMessage({ t: 'call', id: 1, method: 'dialog.open', params: {} });
  await s.settle();
  expect(s.received).toHaveLength(1);
  expect(s.received[0]).toMatchObject({ t: 'result', id: 1, ok: false, error: { code: 'EPERM' } });
  expect(handler).not.toHaveBeenCalled();
});

test('permission is checked before params validation', async () => {
  const handler = vi.fn(async () => null);
  const s = track(setup({ handlers: { 'dialog.open': handler } }));
  s.ch.port2.postMessage({ t: 'call', id: 1, method: 'dialog.open', params: 'garbage' });
  await s.settle();
  expect(s.received[0]).toMatchObject({ ok: false, error: { code: 'EPERM' } });
  expect(handler).not.toHaveBeenCalled();
});

test('dialog.open with fs.dialog reaches the handler with context and validated params', async () => {
  const handler = vi.fn(async () => [{ id: 'x', name: 'x' }]);
  const s = track(setup({ handlers: { 'dialog.open': handler }, permissions: ['fs.dialog'] }));
  s.ch.port2.postMessage({ t: 'call', id: 7, method: 'dialog.open', params: {} });
  await s.settle();
  expect(handler).toHaveBeenCalledTimes(1);
  expect((handler.mock.calls as unknown as [{ instance: AppInstance }][])[0]?.[0].instance.instanceId).toBe(
    'i1',
  );
  expect(s.received).toEqual([{ t: 'result', id: 7, ok: true, value: [{ id: 'x', name: 'x' }] }]);
});

test('missing handler for a known method -> EUNSUPPORTED', async () => {
  const s = track(setup());
  s.ch.port2.postMessage({ t: 'call', id: 1, method: 'theme.get', params: {} });
  await s.settle();
  expect(s.received[0]).toMatchObject({ ok: false, error: { code: 'EUNSUPPORTED' } });
});

test('handler throwing EwError(ENOENT) -> ENOENT result with its message', async () => {
  const s = track(
    setup({
      handlers: {
        'fs.readText': async () => {
          throw new EwError('ENOENT', 'no such file');
        },
      },
    }),
  );
  s.ch.port2.postMessage({ t: 'call', id: 1, method: 'fs.readText', params: { ref: 'r' } });
  await s.settle();
  expect(s.received).toEqual([
    { t: 'result', id: 1, ok: false, error: { code: 'ENOENT', message: 'no such file' } },
  ]);
});

test("handler throwing a plain Error -> EINVAL 'Internal error' with no leak", async () => {
  const s = track(
    setup({
      handlers: {
        'fs.readText': async () => {
          throw new Error('secret /etc/passwd detail');
        },
      },
    }),
  );
  s.ch.port2.postMessage({ t: 'call', id: 1, method: 'fs.readText', params: { ref: 'r' } });
  await s.settle();
  expect(s.received).toEqual([
    { t: 'result', id: 1, ok: false, error: { code: 'EINVAL', message: 'Internal error' } },
  ]);
});

test('garbage gets no reply and increments droppedCount', async () => {
  const s = track(setup());
  expect(s.conn.droppedCount()).toBe(0);
  s.ch.port2.postMessage('hi');
  s.ch.port2.postMessage({ t: 'call' });
  s.ch.port2.postMessage(null);
  await s.settle();
  expect(s.received).toEqual([]);
  expect(s.conn.droppedCount()).toBe(3);
});

test('the 6th call within a second -> ERATE; the first five are served', async () => {
  const handler = vi.fn(async () => null);
  const s = track(setup({ handlers: { 'window.focus': handler }, rate: { max: 5, windowMs: 1000 } }));
  for (let id = 1; id <= 6; id++)
    s.ch.port2.postMessage({ t: 'call', id, method: 'window.focus', params: {} });
  await s.settle();
  expect(handler).toHaveBeenCalledTimes(5);
  const byId = new Map(s.received.map((r) => [r.id, r]));
  for (let id = 1; id <= 5; id++) expect(byId.get(id)).toMatchObject({ ok: true });
  expect(byId.get(6)).toMatchObject({ ok: false, error: { code: 'ERATE' } });
});

test('garbage counts toward the rate limit', async () => {
  const handler = vi.fn(async () => null);
  const s = track(setup({ handlers: { 'window.focus': handler }, rate: { max: 5, windowMs: 1000 } }));
  for (let n = 0; n < 5; n++) s.ch.port2.postMessage('junk');
  s.ch.port2.postMessage({ t: 'call', id: 1, method: 'window.focus', params: {} });
  await s.settle();
  expect(handler).not.toHaveBeenCalled();
  expect(s.received).toHaveLength(1);
  expect(s.received[0]).toMatchObject({ id: 1, ok: false, error: { code: 'ERATE' } });
});

test('a flood produces a bounded number of replies and the limit resets after the window', async () => {
  vi.useFakeTimers({ toFake: ['performance'] });
  const handler = vi.fn(async () => null);
  const s = track(setup({ handlers: { 'window.focus': handler }, rate: { max: 5, windowMs: 1000 } }));
  for (let id = 1; id <= 100; id++)
    s.ch.port2.postMessage({ t: 'call', id, method: 'window.focus', params: {} });
  await s.settle();
  expect(handler).toHaveBeenCalledTimes(5);
  expect(s.received).toHaveLength(10); // 5 results + at most `max` ERATE replies
  expect(s.received.filter((r) => !r.ok)).toHaveLength(5);
  expect(s.conn.droppedCount()).toBe(95);
  vi.advanceTimersByTime(1000);
  s.ch.port2.postMessage({ t: 'call', id: 200, method: 'window.focus', params: {} });
  await s.settle();
  expect(handler).toHaveBeenCalledTimes(6);
});

test('request(ping) resolves true when the fake app answers', async () => {
  const s = track(setup());
  s.ch.port2.addEventListener('message', (e) => {
    const m = e.data as { t: string; id: number; name: string };
    if (m.t === 'request' && m.name === 'ping')
      s.ch.port2.postMessage({ t: 'response', id: m.id, value: true });
  });
  await expect(s.conn.request('ping')).resolves.toBe(true);
  expect(s.received[0]).toMatchObject({ t: 'request', name: 'ping' });
});

test('an unanswered request rejects ECANCELED after its timeout', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] });
  const s = track(setup());
  const p = s.conn.request('ping', undefined, 5000);
  const assertion = expect(p).rejects.toMatchObject({ code: 'ECANCELED', message: 'timeout' });
  await vi.advanceTimersByTimeAsync(5000);
  await assertion;
});

test('detach rejects pending requests with ECANCELED, is idempotent, and stops serving calls', async () => {
  const handler = vi.fn(async () => null);
  const s = track(setup({ handlers: { 'window.focus': handler } }));
  const p = s.conn.request('beforeClose', undefined, 60000);
  const assertion = expect(p).rejects.toMatchObject({ code: 'ECANCELED' });
  s.conn.detach();
  s.conn.detach();
  await assertion;
  await expect(s.conn.request('ping')).rejects.toMatchObject({ code: 'ECANCELED' });
  s.ch.port2.postMessage({ t: 'call', id: 1, method: 'window.focus', params: {} });
  await s.settle();
  expect(handler).not.toHaveBeenCalled();
});

test('emit posts an event message', async () => {
  const s = track(setup());
  s.conn.emit('theme.changed', { tokens: { a: 'b' } });
  await s.settle();
  expect(s.received).toEqual([{ t: 'event', name: 'theme.changed', data: { tokens: { a: 'b' } } }]);
});

test('responses with unknown ids are ignored', async () => {
  const s = track(setup());
  s.ch.port2.postMessage({ t: 'response', id: 999, value: true });
  await s.settle();
  expect(s.received).toEqual([]);
  expect(s.conn.droppedCount()).toBe(0);
});
