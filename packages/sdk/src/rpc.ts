import {
  type EventMap,
  EwError,
  type MessagePortLike,
  type MethodMap,
  type RequestMap,
  type ResultMsg,
  type ShellToAppMsg,
} from '@earlyweb/protocol';

type Pending = { resolve: (v: never) => void; reject: (e: unknown) => void };
type EventName = keyof EventMap;
type EventHandler<K extends EventName> = (data: EventMap[K]) => void;
type RequestHandler<K extends keyof RequestMap> = (data: unknown) => RequestMap[K] | Promise<RequestMap[K]>;

export type Rpc = {
  call<M extends keyof MethodMap>(
    method: M,
    params?: MethodMap[M]['params'],
  ): Promise<MethodMap[M]['result']>;
  on<K extends EventName>(name: K, fn: EventHandler<K>): void;
  off<K extends EventName>(name: K, fn: EventHandler<K>): void;
  handle<K extends keyof RequestMap>(name: K, fn: RequestHandler<K>): void;
};

export function createRpc(port: MessagePortLike): Rpc {
  let nextId = 1;
  const pending = new Map<number, Pending>();
  const listeners = new Map<EventName, Set<(data: never) => void>>();
  const handlers: { [K in keyof RequestMap]: RequestHandler<K> } = {
    ping: () => true,
    beforeClose: () => true,
  };

  const onResult = (m: ResultMsg) => {
    const p = pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    if (m.ok) p.resolve(m.value as never);
    else p.reject(new EwError(m.error.code, m.error.message));
  };

  port.addEventListener('message', (e) => {
    const m = e.data as ShellToAppMsg | null;
    if (!m || typeof m !== 'object') return;
    if (m.t === 'result') onResult(m);
    else if (m.t === 'event') {
      for (const fn of listeners.get(m.name) ?? []) fn(m.data as never);
    } else if (m.t === 'request') {
      const h = handlers[m.name] as RequestHandler<keyof RequestMap> | undefined;
      if (!h) return;
      Promise.resolve()
        .then(() => h(m.data))
        .then(
          (value) => port.postMessage({ t: 'response', id: m.id, value }),
          () => port.postMessage({ t: 'response', id: m.id, value: m.name === 'beforeClose' }),
        );
    }
  });
  port.start();

  return {
    call(method, params) {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: resolve as (v: never) => void, reject });
        port.postMessage({ t: 'call', id, method, params });
      });
    },
    on(name, fn) {
      let set = listeners.get(name);
      if (!set) {
        set = new Set();
        listeners.set(name, set);
      }
      set.add(fn as (data: never) => void);
    },
    off(name, fn) {
      listeners.get(name)?.delete(fn as (data: never) => void);
    },
    handle(name, fn) {
      (handlers as Record<string, unknown>)[name] = fn;
    },
  };
}
