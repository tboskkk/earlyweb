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
  launcher: Pick<ReturnType<typeof createLauncher>, 'launch'>;
  store: WindowStore;
}): Promise<void> {
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
  await p.invoke('e2e_report', { app });
}
