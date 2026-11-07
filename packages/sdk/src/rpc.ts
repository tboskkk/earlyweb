import {
  ERROR_CODES,
  type ErrorCode,
  type EventMap,
  EwError,
  type MessagePortLike,
  type MethodMap,
  type RequestMap,
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

  const onResult = (m: Record<string, unknown>) => {
    if (typeof m.id !== 'number') return;
    const p = pending.get(m.id);
    if (!p) return;
    if (m.ok === true) {
      pending.delete(m.id);
      p.resolve(m.value as never);
    } else if (m.ok === false) {
      pending.delete(m.id);
      const err = m.error as { code?: unknown; message?: unknown } | null | undefined;
      if (
        err &&
        typeof err === 'object' &&
        typeof err.message === 'string' &&
        ERROR_CODES.includes(err.code as ErrorCode)
      ) {
        p.reject(new EwError(err.code as ErrorCode, err.message));
      } else {
        p.reject(new EwError('EINVAL', 'malformed error in result message'));
      }
    }
  };

  port.addEventListener('message', (e) => {
    const m = e.data as Record<string, unknown> | null;
    if (!m || typeof m !== 'object') return;
    if (m.t === 'result') onResult(m);
    else if (m.t === 'event') {
      if (typeof m.name !== 'string') return;
      for (const fn of [...(listeners.get(m.name as EventName) ?? [])]) {
        try {
          fn(m.data as never);
        } catch {
          // a throwing handler must not stop the others
        }
      }
    } else if (m.t === 'request') {
      const { id, name } = m;
      if (typeof id !== 'number' || typeof name !== 'string') return;
      if (!Object.hasOwn(handlers, name)) return;
      const h = handlers[name as keyof RequestMap] as RequestHandler<keyof RequestMap>;
      Promise.resolve()
        .then(() => h(m.data))
        .then(
          (value) => port.postMessage({ t: 'response', id, value }),
          () => port.postMessage({ t: 'response', id, value: name === 'beforeClose' }),
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
