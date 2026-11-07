import {
  AppToShellSchema,
  type EventMap,
  EwError,
  METHODS,
  type MessagePortLike,
  type MethodMap,
  type RequestMap,
  type ResultMsg,
} from '@earlyweb/protocol';
import * as v from 'valibot';
import type { AppInstance } from '../host/handshake.ts';

export type CallContext = { instance: AppInstance };
// biome-ignore lint/suspicious/noExplicitAny: params are validated per-method before the handler runs
export type Handler = (ctx: CallContext, params: any) => Promise<unknown>;

export type Connection = {
  request<K extends keyof RequestMap>(name: K, data?: unknown, timeoutMs?: number): Promise<RequestMap[K]>;
  emit<K extends keyof EventMap>(name: K, data: EventMap[K]): void;
  detach(): void;
  droppedCount(): number;
};

export type Broker = { attach(instance: AppInstance, port: MessagePortLike): Connection };

const DEFAULT_RATE = { max: 200, windowMs: 1000 };
const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

export function createBroker(opts: {
  handlers: Partial<Record<keyof MethodMap, Handler>>;
  rate?: { max: number; windowMs: number };
}): Broker {
  const rate = opts.rate ?? DEFAULT_RATE;

  return {
    attach(instance, port) {
      let closed = false;
      let dropped = 0;
      let nextId = 1;
      const pending = new Map<
        number,
        { resolve: (v: never) => void; reject: (e: unknown) => void; timer: ReturnType<typeof setTimeout> }
      >();

      // Fixed-window rate limiter. Every inbound message (garbage included)
      // counts. Over the limit: valid calls get ERATE for at most `max`
      // messages per window (so replies per window are bounded by 2*max);
      // everything beyond that is dropped silently with no reply.
      let windowStart = Number.NEGATIVE_INFINITY;
      let count = 0;

      const post = (msg: unknown) => {
        if (closed) return;
        try {
          port.postMessage(msg);
        } catch {
          // closed port or uncloneable value; nothing more we can do
        }
      };
      const reply = (
        id: number,
        r: { ok: true; value: unknown } | { ok: false; code: EwError['code']; message: string },
      ) => {
        const msg: ResultMsg = r.ok
          ? { t: 'result', id, ok: true, value: r.value }
          : { t: 'result', id, ok: false, error: { code: r.code, message: r.message } };
        if (closed) return;
        try {
          port.postMessage(msg);
        } catch {
          post({ t: 'result', id, ok: false, error: { code: 'EINVAL', message: 'Internal error' } });
        }
      };
      const fail = (id: number, code: EwError['code'], message: string) =>
        reply(id, { ok: false, code, message });

      const handleCall = async (id: number, method: string, params: unknown) => {
        if (!Object.hasOwn(METHODS, method)) return fail(id, 'EUNSUPPORTED', `Unknown method: ${method}`);
        const def = METHODS[method as keyof MethodMap];
        const needed = (def as { permission?: string }).permission;
        if (needed && !(instance.manifest.permissions as readonly string[]).includes(needed)) {
          return fail(id, 'EPERM', `Permission required: ${needed}`);
        }
        const parsed = v.safeParse(def.params, params);
        if (!parsed.success) return fail(id, 'EINVAL', 'Invalid params');
        const handler = Object.hasOwn(opts.handlers, method)
          ? opts.handlers[method as keyof MethodMap]
          : undefined;
        if (!handler) return fail(id, 'EUNSUPPORTED', `Unsupported method: ${method}`);
        try {
          reply(id, { ok: true, value: await handler({ instance }, parsed.output) });
        } catch (err) {
          if (err instanceof EwError) fail(id, err.code, err.message);
          else fail(id, 'EINVAL', 'Internal error');
        }
      };

      const onMessage = (e: { data: unknown }) => {
        if (closed) return;
        const now = performance.now();
        if (now - windowStart >= rate.windowMs) {
          windowStart = now;
          count = 0;
        }
        count++;
        const parsed = v.safeParse(AppToShellSchema, e.data);
        if (count > rate.max) {
          dropped++;
          if (parsed.success && parsed.output.t === 'call' && count <= rate.max * 2) {
            fail(parsed.output.id, 'ERATE', 'Rate limit exceeded');
          }
          return;
        }
        if (!parsed.success) {
          dropped++;
          return;
        }
        const msg = parsed.output;
        if (msg.t === 'response') {
          const p = pending.get(msg.id);
          if (!p) return;
          pending.delete(msg.id);
          clearTimeout(p.timer);
          p.resolve(msg.value as never);
          return;
        }
        void handleCall(msg.id, msg.method, msg.params);
      };

      port.addEventListener('message', onMessage);
      port.start();

      return {
        request(name, data, timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS) {
          if (closed) return Promise.reject(new EwError('ECANCELED', 'connection closed'));
          const id = nextId++;
          return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
              pending.delete(id);
              reject(new EwError('ECANCELED', 'timeout'));
            }, timeoutMs);
            pending.set(id, { resolve: resolve as (v: never) => void, reject, timer });
            post({ t: 'request', id, name, data });
          });
        },
        emit(name, data) {
          post({ t: 'event', name, data });
        },
        detach() {
          if (closed) return;
          closed = true;
          for (const p of pending.values()) {
            clearTimeout(p.timer);
            p.reject(new EwError('ECANCELED', 'connection closed'));
          }
          pending.clear();
          port.close();
        },
        droppedCount: () => dropped,
      };
    },
  };
}
