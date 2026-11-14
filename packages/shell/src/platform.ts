import {
  createIdbFs,
  createIdbKv,
  createTauriFs,
  createTauriKv,
  type FsBackend,
  type Invoke,
  type Kv,
} from '@earlyweb/backends';
import { APP_ORIGIN } from './config.ts';

/** Where the shell runs: in a browser (IndexedDB, apps from a dev server) or in the desktop app. */
export type Platform = {
  kind: 'web' | 'tauri';
  fs: FsBackend;
  kv: Kv;
  /** Origin that serves the apps, without a trailing `/`. */
  appOrigin: string;
  /** Raw Tauri command access; only present in the desktop app. */
  invoke?: Invoke;
  /** Subscribes to an event emitted by Rust; resolves to an unsubscribe. Desktop app only. */
  onEvent?: (name: string, cb: (payload: unknown) => void) => Promise<() => void>;
};

export async function createPlatform(win: Window = window): Promise<Platform> {
  if ('__TAURI_INTERNALS__' in win) {
    // Loaded on demand so the web build never pulls in Tauri's runtime glue.
    const [{ invoke, convertFileSrc }, { listen }] = await Promise.all([
      import('@tauri-apps/api/core'),
      import('@tauri-apps/api/event'),
    ]);
    return {
      kind: 'tauri',
      fs: createTauriFs(invoke),
      kv: createTauriKv(invoke),
      appOrigin: convertFileSrc('', 'ewapp').replace(/\/$/, ''),
      invoke,
      onEvent: (name, cb) => listen(name, (e) => cb(e.payload)),
    };
  }
  const [fs, kv] = await Promise.all([createIdbFs(), createIdbKv()]);
  return { kind: 'web', fs, kv, appOrigin: APP_ORIGIN };
}
