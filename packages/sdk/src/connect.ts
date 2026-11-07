import { isInit, type MessagePortLike, PROTOCOL_VERSION } from '@earlyweb/protocol';
import { createOs, type Os } from './os.ts';

type MessageEventLike = { data: unknown; ports: readonly MessagePortLike[]; source: unknown };
type Listener = (e: MessageEventLike) => void;

export type ConnectOptions = {
  target?: { postMessage(m: unknown, o: string): void };
  listenOn?: {
    addEventListener(t: 'message', fn: Listener): void;
    removeEventListener(t: 'message', fn: Listener): void;
  };
  timeoutMs?: number;
};

export function connect(opts: ConnectOptions = {}): Promise<Os> {
  const target = opts.target ?? window.parent;
  const listenOn = opts.listenOn ?? (window as unknown as NonNullable<ConnectOptions['listenOn']>);
  const timeoutMs = opts.timeoutMs ?? 5000;

  return new Promise<Os>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      listenOn.removeEventListener('message', onMessage);
    };
    const onMessage: Listener = (e) => {
      if (e.source !== target) return;
      const port = e.ports[0];
      if (!port || !isInit(e.data)) return;
      cleanup();
      resolve(createOs(e.data, port));
    };
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error('EarlyWeb handshake timed out: not running inside EarlyWeb'));
    }, timeoutMs);

    listenOn.addEventListener('message', onMessage);
    target.postMessage({ ew: 'hello', protocol: PROTOCOL_VERSION }, '*');
  });
}
