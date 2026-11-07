import {
  type InitMsg,
  isHello,
  type LaunchArgs,
  type Manifest,
  type MessagePortLike,
  PROTOCOL_VERSION,
} from '@earlyweb/protocol';

export type AppInstance = {
  instanceId: string;
  appId: string;
  manifest: Manifest;
  windowId: string;
  launch: LaunchArgs;
};

type MessageEventLike = { source: unknown; data: unknown };
type PostTarget = { postMessage(msg: unknown, targetOrigin: string, transfer: Transferable[]): void };

export type Handshake = {
  register(frameWindow: unknown, instance: AppInstance): void;
  unregister(frameWindow: unknown): void;
};

export function createHandshake(opts: {
  listenOn: { addEventListener(type: 'message', fn: (e: MessageEventLike) => void): void };
  onConnect(instance: AppInstance, port: MessagePortLike): void;
  makeInit(instance: AppInstance): Omit<InitMsg, 'ew' | 'protocol'>;
}): Handshake {
  const frames = new Map<unknown, { instance: AppInstance; connected: boolean }>();

  opts.listenOn.addEventListener('message', (e) => {
    const entry = frames.get(e.source);
    // Only a registered frame window may handshake, and only once.
    if (!entry || entry.connected || !isHello(e.data) || e.data.protocol !== PROTOCOL_VERSION) return;
    entry.connected = true;
    const channel = new MessageChannel();
    const init: InitMsg = { ew: 'init', protocol: PROTOCOL_VERSION, ...opts.makeInit(entry.instance) };
    // The sandboxed frame has an opaque origin, so '*' is unavoidable; the
    // message goes only to the registered frame window and carries no secrets
    // beyond that app's own instance data.
    (e.source as PostTarget).postMessage(init, '*', [channel.port2]);
    opts.onConnect(entry.instance, channel.port1 as unknown as MessagePortLike);
  });

  return {
    register(frameWindow, instance) {
      frames.set(frameWindow, { instance, connected: false });
    },
    unregister(frameWindow) {
      frames.delete(frameWindow);
    },
  };
}
