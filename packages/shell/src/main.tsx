import '@earlyweb/themes/glass/chrome.css';
import { ensureHome } from '@earlyweb/backends';
import { applyTheme, glass } from '@earlyweb/themes';
import { effect, signal } from '@preact/signals';
import { render } from 'preact';
import { createBroker } from './broker/broker.ts';
import { appHandlers } from './broker/methods/app.ts';
import { dialogHandlers } from './broker/methods/dialog.ts';
import { fsHandlers } from './broker/methods/fs.ts';
import { themeHandlers } from './broker/methods/theme.ts';
import { windowHandlers } from './broker/methods/window.ts';
import { createDialogService } from './dialogs/dialog-service.ts';
import { ModalLayer } from './dialogs/ModalLayer.tsx';
import { AppFrame } from './host/AppFrame.tsx';
import { emitInitialFocus, forwardWindowEvents, onWindowBlur } from './host/events.ts';
import { createHandshake } from './host/handshake.ts';
import { createLauncher } from './host/launcher.ts';
import { createPlatform } from './platform.ts';
import { runSelftest } from './selftest.ts';
import { createFsService } from './services/fs-service.ts';
import { createGrantTable } from './services/grants.ts';
import { bootSession } from './state/boot-session.ts';
import { type CatalogEntry, loadCatalog } from './state/catalog.ts';
import { loadSession, restoreSession, saveSession, snapshot } from './state/session.ts';
import { createSessionSaver } from './state/session-saver.ts';
import { createWindowStore } from './state/windows.ts';
import { Desktop } from './ui/Desktop.tsx';
import { onUpdateAvailable } from './update-prompt.ts';

applyTheme(glass);

const viewport = signal({ width: window.innerWidth, height: window.innerHeight });
window.addEventListener('resize', () => {
  viewport.value = { width: window.innerWidth, height: window.innerHeight };
});
const store = createWindowStore(viewport);

async function boot() {
  const platform = await createPlatform();
  const { fs, kv } = platform;
  await ensureHome(fs);
  const grants = await createGrantTable(kv);
  const fsService = createFsService(fs, grants);
  const dialogs = createDialogService();
  // saver is defined below; the hook is only invoked later.
  if (import.meta.env.DEV)
    (window as unknown as { __ew?: unknown }).__ew = { dialogs, sessionIdle: () => saver.idle() };

  // Rust announces a newer release it found; the user picks when to download and restart.
  const { invoke, onEvent } = platform;
  if (invoke && onEvent) {
    void onEvent('ew://update-available', (payload) => {
      const version = (payload as { version?: unknown } | null)?.version;
      if (typeof version === 'string') void onUpdateAvailable(version, { dialogs, invoke });
    });
  }

  const catalog = signal<CatalogEntry[]>([]);
  // false when the catalog failed to load: then saving stays disabled so the stored
  // session is not overwritten by the (empty) restored state.
  const catalogReady = loadCatalog(platform.appOrigin).then(
    (entries) => {
      catalog.value = entries;
      return true;
    },
    (err) => {
      console.error('catalog load failed', err);
      return false;
    },
  );

  // The launcher needs the broker and handshake, whose handlers need the launcher.
  const lazy: { launcher?: ReturnType<typeof createLauncher> } = {};
  const broker = createBroker({
    handlers: {
      ...appHandlers({ onReady: (id) => lazy.launcher?.ready(id) }),
      ...windowHandlers(store, {
        getViewport: () => viewport.peek(),
        onClose: (id) => void lazy.launcher?.close(id),
      }),
      ...fsHandlers(fsService),
      ...dialogHandlers({
        dialogs,
        grants,
        fs,
        isLive: (id) => lazy.launcher?.instances.peek().has(id) ?? false,
        onGrant: (id, ref) => lazy.launcher?.setLaunchFile(id, ref),
      }),
      ...themeHandlers(() => glass),
    },
  });
  const handshake = createHandshake({
    listenOn: window,
    onConnect: (instance, port) => {
      lazy.launcher?.connect(instance, port);
      const conn = lazy.launcher?.instances.peek().get(instance.instanceId)?.conn;
      emitInitialFocus(store, conn, instance.windowId);
    },
    makeInit: (instance) => ({
      instanceId: instance.instanceId,
      appId: instance.appId,
      launch: instance.launch,
      theme: { tokens: glass.tokens },
      permissions: instance.manifest.permissions,
    }),
  });
  const launcher = createLauncher({ store, catalog, handshake, broker });
  lazy.launcher = launcher;

  // Instead of widening the launcher interface: when an instance disappears from the
  // launcher's signal (close or end task), drop its pending trusted dialogs.
  let known = new Set<string>();
  effect(() => {
    const now = new Set(launcher.instances.value.keys());
    for (const id of known) if (!now.has(id)) dialogs.cancelFor(id);
    known = now;
  });

  const instanceOfWindow = (windowId: string) => {
    for (const e of launcher.instances.peek().values()) if (e.instance.windowId === windowId) return e;
    return undefined;
  };
  forwardWindowEvents(store, (windowId) => instanceOfWindow(windowId)?.conn);

  const frameWindows = new Map<unknown, string>();
  window.addEventListener('blur', () => {
    onWindowBlur(
      store,
      () => {
        const el = document.activeElement as HTMLIFrameElement | null;
        return el?.tagName === 'IFRAME' ? el : null;
      },
      (f) => frameWindows.get(f),
    );
  });

  // Session: restore once the catalog is loaded, and only then enable saving (an empty
  // initial store must not overwrite the stored session). Policy: debounce 500 ms for
  // churn (drag/resize); save immediately when the set of windows or a launch file
  // changes, and when the page is hidden.
  const saver = createSessionSaver({
    save: () => saveSession(kv, snapshot(store, launcher.instances)),
    onError: (err) => console.error('session save failed', err),
    debounceMs: 500,
  });
  let lastKey = '';
  const structureKey = () =>
    JSON.stringify(snapshot(store, launcher.instances).map((r) => [r.appId, r.launch.file?.id ?? null]));
  effect(() => {
    store.windows.value;
    launcher.instances.value;
    const key = structureKey();
    if (key !== lastKey) {
      lastKey = key;
      saver.flushNow();
    } else saver.schedule();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') saver.flushNow();
  });
  window.addEventListener('pagehide', () => saver.flushNow());
  void catalogReady
    .then(async (ok) => {
      if (!ok) return; // catalog failed: leave the stored session untouched, never enable saving
      await bootSession({
        load: () => loadSession(kv),
        restore: (records) => restoreSession(records, launcher, catalog, store),
        enable: () => {
          lastKey = structureKey();
          saver.enable();
        },
      });
      // Desktop self-test builds only (`--features e2e` injects the flag into this frame).
      const invoke = platform.invoke;
      const selftest = (window as { __EW_SELFTEST__?: unknown }).__EW_SELFTEST__ === true;
      if (platform.kind === 'tauri' && invoke && selftest) {
        await runSelftest({ fs, invoke, launcher, store }).catch((err) =>
          invoke('e2e_report', { app: `error: ${err instanceof Error ? err.message : String(err)}` }),
        );
      }
    })
    .catch((err) => console.error('session boot failed', err));

  function Root() {
    return (
      <>
        <Desktop
          store={store}
          apps={catalog.value}
          onLaunch={(appId) => launcher.launch(appId)}
          renderApp={(win) => {
            const entry = launcher.instances.value.get(win.instanceId);
            if (!entry) return null;
            return (
              <AppFrame
                key={win.id}
                appId={entry.instance.appId}
                baseUrl={entry.baseUrl}
                entry={entry.instance.manifest.entry}
                onWindow={(frame) => {
                  if (frame) frameWindows.set(frame, win.id);
                  else for (const [f, id] of frameWindows) if (id === win.id) frameWindows.delete(f);
                  launcher.attachFrame(entry.instance.instanceId, frame);
                }}
              />
            );
          }}
          onCloseRequest={(id) => {
            const e = instanceOfWindow(id);
            if (e) void launcher.close(e.instance.instanceId);
            else store.close(id);
          }}
          onEndTask={(id) => {
            const e = instanceOfWindow(id);
            if (e) launcher.endTask(e.instance.instanceId);
            else store.close(id);
          }}
        />
        <ModalLayer dialogs={dialogs} fs={fs} />
      </>
    );
  }

  render(<Root />, document.getElementById('app') as HTMLElement);
}

boot().catch((err) => {
  console.error('boot failed', err);
  const root = document.getElementById('app');
  if (root)
    root.textContent = `EarlyWeb failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
