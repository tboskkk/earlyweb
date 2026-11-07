import type { LaunchArgs, MessagePortLike } from '@earlyweb/protocol';
import type { Signal } from '@preact/signals';
import { signal } from '@preact/signals';
import type { Broker, Connection } from '../broker/broker.ts';
import type { CatalogEntry } from '../state/catalog.ts';
import type { Rect, WindowStore } from '../state/windows.ts';
import type { AppInstance, Handshake } from './handshake.ts';
import { requestClose, startWatchdog } from './lifecycle.ts';

export type InstanceEntry = { instance: AppInstance; conn?: Connection; baseUrl: string };

const READY_FALLBACK_MS = 3000;

export type Launcher = {
  launch(appId: string, launch?: LaunchArgs, rect?: Partial<Rect>): string;
  instances: Signal<Map<string, InstanceEntry>>;
  close(instanceId: string): Promise<void>;
  endTask(instanceId: string): void;
  /** Pass to createHandshake as onConnect: attaches the broker and starts the watchdog. */
  connect(instance: AppInstance, port: MessagePortLike): void;
  /** AppFrame's onWindow callback target: registers the frame for the handshake. */
  attachFrame(instanceId: string, frameWindow: unknown): void;
  /** Called by the app.ready handler: reveals the window. */
  ready(instanceId: string): void;
};

type Runtime = { frame?: unknown; stopWatchdog?: () => void; fallback?: ReturnType<typeof setTimeout> };

export function createLauncher(deps: {
  store: WindowStore;
  catalog: Signal<CatalogEntry[]>;
  handshake: Handshake;
  broker: Broker;
}): Launcher {
  const { store, catalog, handshake, broker } = deps;
  const instances = signal(new Map<string, InstanceEntry>());
  const runtime = new Map<string, Runtime>();

  const setEntry = (id: string, entry: InstanceEntry) => {
    const next = new Map(instances.peek());
    next.set(id, entry);
    instances.value = next;
  };

  const ready = (instanceId: string) => {
    const rt = runtime.get(instanceId);
    const entry = instances.peek().get(instanceId);
    if (!rt || !entry) return;
    clearTimeout(rt.fallback);
    rt.fallback = undefined;
    store.update(entry.instance.windowId, { shown: true });
  };

  const endTask = (instanceId: string) => {
    const entry = instances.peek().get(instanceId);
    if (!entry) return;
    const rt = runtime.get(instanceId);
    clearTimeout(rt?.fallback);
    rt?.stopWatchdog?.(); // before detach so detach's cancellations are not reported
    if (rt?.frame !== undefined) handshake.unregister(rt.frame);
    entry.conn?.detach();
    runtime.delete(instanceId);
    const next = new Map(instances.peek());
    next.delete(instanceId);
    instances.value = next;
    store.close(entry.instance.windowId);
  };

  return {
    instances,
    ready,
    endTask,
    launch(appId, launch = { args: [] }, rect) {
      const cat = catalog.peek().find((c) => c.manifest.id === appId);
      if (!cat) throw new Error(`unknown app: ${appId}`);
      const win = cat.manifest.window;

      if (win.singleInstance) {
        for (const e of instances.peek().values()) {
          if (e.instance.appId !== appId) continue;
          if (launch.file) e.conn?.emit('file.open', { file: launch.file });
          store.focus(e.instance.windowId);
          return e.instance.instanceId;
        }
      }

      const instanceId = crypto.randomUUID();
      const icon16 = cat.manifest.icons['16'];
      const windowId = store.open({
        appId,
        instanceId,
        title: cat.manifest.name,
        icon: icon16 ? cat.baseUrl + icon16 : '',
        w: win.width,
        h: win.height,
        minW: win.minWidth,
        minH: win.minHeight,
        resizable: win.resizable,
        rect,
      });
      const instance: AppInstance = { instanceId, appId, manifest: cat.manifest, windowId, launch };
      setEntry(instanceId, { instance, baseUrl: cat.baseUrl });
      runtime.set(instanceId, { fallback: setTimeout(() => ready(instanceId), READY_FALLBACK_MS) });
      return instanceId;
    },
    attachFrame(instanceId, frameWindow) {
      const entry = instances.peek().get(instanceId);
      const rt = runtime.get(instanceId);
      if (!entry || !rt) return;
      if (frameWindow === rt.frame) return; // re-render of the same frame
      if (rt.frame !== undefined) handshake.unregister(rt.frame);
      if (frameWindow == null) {
        rt.frame = undefined;
        return;
      }
      rt.frame = frameWindow;
      handshake.register(frameWindow, entry.instance);
    },
    connect(instance, port) {
      const entry = instances.peek().get(instance.instanceId);
      const rt = runtime.get(instance.instanceId);
      // Refuse unknown/ended instances and any second connection.
      if (!entry || !rt || entry.conn) {
        port.close();
        return;
      }
      const conn = broker.attach(instance, port);
      setEntry(instance.instanceId, { ...entry, conn });
      rt.stopWatchdog = startWatchdog(conn, (notResponding) => {
        store.update(instance.windowId, { notResponding });
      });
    },
    async close(instanceId) {
      const entry = instances.peek().get(instanceId);
      if (!entry) return;
      if (!entry.conn) return endTask(instanceId);
      const outcome = await requestClose(entry.conn);
      if (!instances.peek().has(instanceId)) return;
      if (outcome === 'close') endTask(instanceId);
      else if (outcome === 'timeout') store.update(entry.instance.windowId, { notResponding: true });
    },
  };
}
