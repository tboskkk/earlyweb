import { PROTOCOL_VERSION } from '@earlyweb/protocol';
import { describe, expect, it } from 'vitest';
import { connect } from '../src/connect.ts';

const init = {
  ew: 'init',
  protocol: PROTOCOL_VERSION,
  instanceId: 'i1',
  appId: 'a1',
  launch: { file: { id: 'f1', name: 'n.txt' }, args: ['x'] },
  theme: { tokens: {} },
  permissions: [],
};

type Listener = (e: { data: unknown; ports: readonly MessagePort[]; source: unknown }) => void;

function env() {
  const posted: [unknown, string][] = [];
  const target = { postMessage: (m: unknown, o: string) => void posted.push([m, o]) };
  const listeners = new Set<Listener>();
  const listenOn = {
    addEventListener: (_t: 'message', fn: Listener) => void listeners.add(fn),
    removeEventListener: (_t: 'message', fn: Listener) => void listeners.delete(fn),
  };
  return { posted, target, listeners, listenOn };
}

describe('connect', () => {
  it('posts hello, resolves on init from target, ignores other sources', async () => {
    const { posted, target, listeners, listenOn } = env();
    const ch = new MessageChannel();
    const p = connect({ target, listenOn, timeoutMs: 1000 });
    expect(posted).toEqual([[{ ew: 'hello', protocol: 1 }, '*']]);
    for (const l of listeners) l({ data: init, ports: [ch.port2], source: {} });
    for (const l of listeners) l({ data: { ...init, appId: 5 }, ports: [ch.port2], source: target });
    for (const l of listeners) l({ data: init, ports: [], source: target });
    expect(listeners.size).toBe(1);
    for (const l of listeners) l({ data: init, ports: [ch.port2], source: target });
    const os = await p;
    expect(os.launch).toEqual(init.launch);
    expect(listeners.size).toBe(0);
    ch.port1.close();
    ch.port2.close();
  });

  it('rejects on timeout and removes listener', async () => {
    const { listeners, target, listenOn } = env();
    await expect(connect({ target, listenOn, timeoutMs: 50 })).rejects.toThrow(/not running inside EarlyWeb/);
    expect(listeners.size).toBe(0);
  });
});
