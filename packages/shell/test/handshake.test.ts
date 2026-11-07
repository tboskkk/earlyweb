import type { Manifest } from '@earlyweb/protocol';
import { expect, test, vi } from 'vitest';
import { type AppInstance, createHandshake } from '../src/host/handshake.ts';

const closePorts = (fn: ReturnType<typeof vi.fn>) => {
  for (const c of fn.mock.calls) (c[1] as MessagePort).close();
};

type Listener = (e: { source: unknown; data: unknown }) => void;

function setup() {
  let listener: Listener | undefined;
  const listenOn = {
    addEventListener(_t: 'message', fn: Listener) {
      listener = fn;
    },
  };
  const onConnect = vi.fn();
  const makeInit = vi.fn((i: AppInstance) => ({
    instanceId: i.instanceId,
    appId: i.appId,
    launch: i.launch,
    theme: { tokens: {} },
    permissions: [],
  }));
  const hs = createHandshake({ listenOn, onConnect, makeInit });
  const frame = () => ({ postMessage: vi.fn() });
  const inst = (id: string): AppInstance => ({
    instanceId: id,
    appId: `app.${id}`,
    manifest: {} as Manifest,
    windowId: `w-${id}`,
    launch: { args: [] },
  });
  const send = (source: unknown, data: unknown) => listener?.({ source, data });
  return { hs, onConnect, makeInit, frame, inst, send };
}

test('hello from a registered frame connects once and posts init with exactly one port', () => {
  const { hs, onConnect, frame, inst, send } = setup();
  const f = frame();
  const i = inst('a');
  hs.register(f, i);
  send(f, { ew: 'hello', protocol: 1 });
  expect(onConnect).toHaveBeenCalledTimes(1);
  expect(onConnect.mock.calls[0]?.[0]).toBe(i);
  expect(f.postMessage).toHaveBeenCalledTimes(1);
  const [msg, origin, transfer] = f.postMessage.mock.calls[0] ?? [];
  expect(msg).toMatchObject({ ew: 'init', protocol: 1, instanceId: 'a', appId: 'app.a' });
  expect(origin).toBe('*');
  expect(transfer).toHaveLength(1);
  expect(transfer[0]).toBeInstanceOf(MessagePort);
  closePorts(onConnect);
  for (const p of transfer as MessagePort[]) p.close();
});

test('a second hello from the same frame is ignored', () => {
  const { hs, onConnect, frame, inst, send } = setup();
  const f = frame();
  hs.register(f, inst('a'));
  send(f, { ew: 'hello', protocol: 1 });
  send(f, { ew: 'hello', protocol: 1 });
  expect(onConnect).toHaveBeenCalledTimes(1);
  expect(f.postMessage).toHaveBeenCalledTimes(1);
  closePorts(onConnect);
});

test('hello from an unregistered source is ignored', () => {
  const { hs, onConnect, frame, inst, send } = setup();
  const registered = frame();
  const stranger = frame();
  hs.register(registered, inst('a'));
  send(stranger, { ew: 'hello', protocol: 1 });
  expect(onConnect).not.toHaveBeenCalled();
  expect(stranger.postMessage).not.toHaveBeenCalled();
  expect(registered.postMessage).not.toHaveBeenCalled();
});

test('hello after unregister is ignored', () => {
  const { hs, onConnect, frame, inst, send } = setup();
  const f = frame();
  hs.register(f, inst('a'));
  hs.unregister(f);
  send(f, { ew: 'hello', protocol: 1 });
  expect(onConnect).not.toHaveBeenCalled();
});

test('hello with protocol 2 is ignored', () => {
  const { hs, onConnect, frame, inst, send } = setup();
  const f = frame();
  hs.register(f, inst('a'));
  send(f, { ew: 'hello', protocol: 2 });
  expect(onConnect).not.toHaveBeenCalled();
  expect(f.postMessage).not.toHaveBeenCalled();
});

test('a non-hello message from a registered frame is ignored', () => {
  const { hs, onConnect, frame, inst, send } = setup();
  const f = frame();
  hs.register(f, inst('a'));
  send(f, { ew: 'init', protocol: 1 });
  send(f, 'hello');
  send(f, null);
  expect(onConnect).not.toHaveBeenCalled();
  expect(f.postMessage).not.toHaveBeenCalled();
});

test("each frame only ever receives its own app's instance", () => {
  const { hs, onConnect, frame, inst, send } = setup();
  const fa = frame();
  const fb = frame();
  hs.register(fa, inst('a'));
  hs.register(fb, inst('b'));
  send(fb, { ew: 'hello', protocol: 1 });
  expect(fa.postMessage).not.toHaveBeenCalled();
  expect(fb.postMessage.mock.calls[0]?.[0]).toMatchObject({ instanceId: 'b' });
  expect(onConnect.mock.calls[0]?.[0].instanceId).toBe('b');
  closePorts(onConnect);
});

test('re-registering the same window keeps its connected state: a second hello is ignored', () => {
  const { hs, onConnect, frame, inst, send } = setup();
  const f = frame();
  const i = inst('a');
  hs.register(f, i);
  send(f, { ew: 'hello', protocol: 1 });
  hs.register(f, i);
  send(f, { ew: 'hello', protocol: 1 });
  expect(onConnect).toHaveBeenCalledTimes(1);
  expect(f.postMessage).toHaveBeenCalledTimes(1);
  closePorts(onConnect);
});

test('the port given to onConnect is the pair of the transferred port', async () => {
  const { hs, onConnect, frame, inst, send } = setup();
  const f = frame();
  hs.register(f, inst('a'));
  send(f, { ew: 'hello', protocol: 1 });
  const shellPort = onConnect.mock.calls[0]?.[1] as MessagePort;
  const transferred = (f.postMessage.mock.calls[0] ?? [])[2] as MessagePort[];
  const appPort = transferred[0] as MessagePort;
  expect(shellPort).not.toBe(appPort);
  const got = new Promise((r) =>
    appPort.addEventListener('message', (e) => r((e as MessageEvent).data), { once: true }),
  );
  appPort.start();
  shellPort.postMessage('ping-from-shell');
  await expect(got).resolves.toBe('ping-from-shell');
  const back = new Promise((r) =>
    shellPort.addEventListener('message', (e) => r((e as MessageEvent).data), { once: true }),
  );
  shellPort.start();
  appPort.postMessage('pong-from-app');
  await expect(back).resolves.toBe('pong-from-app');
  shellPort.close();
  appPort.close();
});

test('makeInit throwing does not escape the listener, connects nothing, and allows a retry', () => {
  const { hs, onConnect, makeInit, frame, inst, send } = setup();
  const f = frame();
  hs.register(f, inst('a'));
  makeInit.mockImplementationOnce(() => {
    throw new Error('boom');
  });
  expect(() => send(f, { ew: 'hello', protocol: 1 })).not.toThrow();
  expect(onConnect).not.toHaveBeenCalled();
  expect(f.postMessage).not.toHaveBeenCalled();
  send(f, { ew: 'hello', protocol: 1 });
  expect(onConnect).toHaveBeenCalledTimes(1);
  closePorts(onConnect);
});

test('postMessage throwing does not escape the listener and connects nothing', () => {
  const { hs, onConnect, frame, inst, send } = setup();
  const f = frame();
  f.postMessage.mockImplementationOnce(() => {
    throw new Error('gone');
  });
  hs.register(f, inst('a'));
  expect(() => send(f, { ew: 'hello', protocol: 1 })).not.toThrow();
  expect(onConnect).not.toHaveBeenCalled();
});
