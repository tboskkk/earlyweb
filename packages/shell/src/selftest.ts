// The desktop IPC self-test (e2e builds only; see src-tauri/src/e2e.rs). The shell writes
// a canary file through Rust, then launches a hostile app that tries every way to reach
// Tauri IPC and read it. The app reports its own verdict in its window title; Rust judges
// the real outcome (did anything read the canary?) and sets the process exit code.
import type { FsBackend, Invoke } from '@earlyweb/backends';
import { effect } from '@preact/signals';
import type { createLauncher } from './host/launcher.ts';
import type { WindowStore } from './state/windows.ts';

export const CANARY_PATH = '/home/user/Documents/canary.txt';
export const HOSTILE_IPC_APP = 'test.earlyweb.hostile-ipc';
const RESULT_PREFIX = 'RESULT ';
const RESULT_TIMEOUT_MS = 60_000;
/** Rust emits this back when the shell invokes `e2e_ping`: proves Rust -> shell events
 * (which the update prompt relies on) are allowed by the shell's capability. */
export const PING_EVENT = 'ew://selftest-ping';
const PING_TIMEOUT_MS = 5000;

type OnEvent = (name: string, cb: (payload: unknown) => void) => Promise<() => void>;

/** True only if the shell can subscribe and Rust's event actually arrives. */
async function eventsWork(invoke: Invoke, onEvent: OnEvent): Promise<boolean> {
  let unlisten = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const arrived = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => resolve(false), PING_TIMEOUT_MS);
      onEvent(PING_EVENT, () => resolve(true))
        .then(
          (u) => {
            unlisten = u;
            return invoke('e2e_ping');
          },
          (err) => {
            console.error('selftest: cannot listen for events', err);
            resolve(false);
          },
        )
        .catch(() => resolve(false));
    });
    return await arrived;
  } finally {
    clearTimeout(timer);
    unlisten();
  }
}

/** The first title of a window of `appId` that starts with `prefix`. */
export function waitForTitle(
  store: WindowStore,
  appId: string,
  prefix: string,
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let dispose = () => {};
    const timer = setTimeout(() => {
      dispose();
      reject(new Error(`timed out waiting for a "${prefix}" title from ${appId}`));
    }, timeoutMs);
    dispose = effect(() => {
      const hit = store.windows.value.find((w) => w.appId === appId && w.title.startsWith(prefix));
      if (!hit) return;
      clearTimeout(timer);
      queueMicrotask(() => dispose());
      resolve(hit.title);
    });
  });
}

export async function runSelftest(p: {
  fs: FsBackend;
  invoke: Invoke;
  onEvent: OnEvent;
  launcher: Pick<ReturnType<typeof createLauncher>, 'launch'>;
  store: WindowStore;
}): Promise<void> {
  const events = await eventsWork(p.invoke, p.onEvent);
  const token = String(await p.invoke('e2e_canary'));
  // Written, never read: any read of the canary counts against the run.
  await p.fs.write(CANARY_PATH, new Blob([token]));
  p.launcher.launch(HOSTILE_IPC_APP);
  let app: string;
  try {
    const title = await waitForTitle(p.store, HOSTILE_IPC_APP, RESULT_PREFIX, RESULT_TIMEOUT_MS);
    app = title.slice(RESULT_PREFIX.length);
  } catch {
    app = 'timeout';
  }
  await p.invoke('e2e_report', { app, events });
}
