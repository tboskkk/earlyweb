import { EwError } from '@earlyweb/protocol';
import { describe, expect, it } from 'vitest';
import { createRpc } from '../src/rpc.ts';

function setup() {
  const ch = new MessageChannel();
  const rpc = createRpc(ch.port1);
  const inbox: unknown[] = [];
  const waiters: ((m: unknown) => void)[] = [];
  ch.port2.onmessage = (e) => {
    const w = waiters.shift();
    if (w) w(e.data);
    else inbox.push(e.data);
  };
  const next = () =>
    new Promise<unknown>((res) => {
      const m = inbox.shift();
      if (m !== undefined) res(m);
      else waiters.push(res);
    });
  return {
    ch,
    rpc,
    next,
    close: () => {
      ch.port1.close();
      ch.port2.close();
    },
  };
}

describe('rpc', () => {
  it('posts a call with id 1 and resolves on result', async () => {
    const { ch, rpc, next, close } = setup();
    const p = rpc.call('window.setTitle', { title: 'x' });
    expect(await next()).toEqual({ t: 'call', id: 1, method: 'window.setTitle', params: { title: 'x' } });
    ch.port2.postMessage({ t: 'result', id: 1, ok: true, value: null });
    expect(await p).toBeNull();
    const p2 = rpc.call('window.close');
    expect(((await next()) as { id: number }).id).toBe(2);
    ch.port2.postMessage({ t: 'result', id: 2, ok: true, value: null });
    await p2;
    close();
  });

  it('rejects with EwError on ok:false', async () => {
    const { ch, rpc, next, close } = setup();
    const p = rpc.call('window.close');
    await next();
    ch.port2.postMessage({ t: 'result', id: 1, ok: false, error: { code: 'EPERM', message: 'no' } });
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(EwError);
    expect((err as EwError).code).toBe('EPERM');
    expect((err as EwError).message).toBe('no');
    close();
  });

  it('dispatches events to on handlers', async () => {
    const { ch, rpc, close } = setup();
    const got = new Promise((res) => rpc.on('resize', res));
    ch.port2.postMessage({ t: 'event', name: 'resize', data: { width: 1, height: 2 } });
    expect(await got).toEqual({ width: 1, height: 2 });
    close();
  });

  it('answers ping and beforeClose by default, and honours handle()', async () => {
    const { ch, rpc, next, close } = setup();
    ch.port2.postMessage({ t: 'request', id: 9, name: 'ping' });
    expect(await next()).toEqual({ t: 'response', id: 9, value: true });
    ch.port2.postMessage({ t: 'request', id: 10, name: 'beforeClose' });
    expect(await next()).toEqual({ t: 'response', id: 10, value: true });
    rpc.handle('beforeClose', () => false);
    ch.port2.postMessage({ t: 'request', id: 11, name: 'beforeClose' });
    expect(await next()).toEqual({ t: 'response', id: 11, value: false });
    close();
  });

  it('ignores garbage messages and still resolves later calls', async () => {
    const { ch, rpc, next, close } = setup();
    const p = rpc.call('window.close');
    await next();
    for (const g of [
      null,
      'str',
      42,
      { t: 'weird' },
      { t: 'result', id: 99, ok: true, value: 1 },
      { t: 'result', ok: true },
      { t: 'event' },
      { t: 'request', id: 'x', name: 'ping' },
      { t: 'request', id: 5, name: 'nope' },
    ]) {
      ch.port2.postMessage(g);
    }
    ch.port2.postMessage({ t: 'result', id: 1, ok: true, value: null });
    expect(await p).toBeNull();
    close();
  });

  it('rejects with EINVAL when ok:false carries no valid error', async () => {
    const { ch, rpc, next, close } = setup();
    const p = rpc.call('window.close');
    await next();
    ch.port2.postMessage({ t: 'result', id: 1, ok: false });
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(EwError);
    expect((err as EwError).code).toBe('EINVAL');
    close();
  });

  it('a throwing event handler does not stop later handlers', async () => {
    const { ch, rpc, close } = setup();
    rpc.on('resize', () => {
      throw new Error('boom');
    });
    const got = new Promise((res) => rpc.on('resize', res));
    ch.port2.postMessage({ t: 'event', name: 'resize', data: { width: 3, height: 4 } });
    expect(await got).toEqual({ width: 3, height: 4 });
    close();
  });
});
