// Desktop self-test fixture: an app with no permissions that tries every known way to
// reach Tauri IPC and read the canary file the shell wrote. It reports its own verdict in
// its window title (`RESULT blocked` or `RESULT LEAK:<names>`); Rust independently
// counts canary reads (src-tauri/src/e2e.rs), which is the real judge for channels whose
// effect the app cannot observe.
import { connect } from '@earlyweb/sdk';

type Verdict = 'blocked' | 'LEAK';

const CANARY = '/home/user/Documents/canary.txt';
const TIMEOUT_MS = 5000;
const NO_ANSWER = Symbol('no answer');

const os = await connect();
await os.ready();

const info: string[] = [];
const g = globalThis as unknown as Record<string, unknown>;

/** Resolves to the value, or NO_ANSWER after the timeout. Rejections propagate. */
async function within<T>(p: Promise<T>): Promise<T | typeof NO_ANSWER> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof NO_ANSWER>((resolve) => {
    timer = setTimeout(() => resolve(NO_ANSWER), TIMEOUT_MS);
  });
  try {
    return await Promise.race([p, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

type Internals = { invoke?: (cmd: string, args?: unknown) => Promise<unknown> };

/** Calling Tauri's injected invoke directly. Present on Windows (subframe injection). */
async function internalsInvoke(): Promise<Verdict> {
  const internals = g.__TAURI_INTERNALS__ as Internals | undefined;
  info.push(`__TAURI_INTERNALS__ present: ${internals !== undefined}`);
  if (typeof internals?.invoke !== 'function') return 'blocked';
  try {
    const r = await within(internals.invoke('fs_read', { path: CANARY }));
    return r === NO_ANSWER ? 'blocked' : 'LEAK';
  } catch {
    return 'blocked';
  }
}

/** Posting straight to the IPC custom protocol, both spellings. */
async function ipcFetch(): Promise<Verdict> {
  const urls = ['ipc://localhost/fs_read', 'http://ipc.localhost/fs_read'];
  const verdicts = await Promise.all(
    urls.map(async (url): Promise<Verdict> => {
      try {
        const res = await within(
          fetch(url, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ path: CANARY }),
          }),
        );
        return res !== NO_ANSWER && res.ok ? 'LEAK' : 'blocked';
      } catch {
        return 'blocked';
      }
    }),
  );
  return verdicts.includes('LEAK') ? 'LEAK' : 'blocked';
}

type Poster = { postMessage?: (m: unknown) => void };

/** The webviews' native message channels. Fire and forget: Rust counts canary reads. */
function nativeChannels(): Verdict {
  const message = JSON.stringify({
    cmd: 'fs_read',
    callback: 1,
    error: 2,
    payload: { path: CANARY },
    options: {},
  });
  const webkit = g.webkit as { messageHandlers?: Record<string, Poster> } | undefined;
  const chrome = g.chrome as { webview?: Poster } | undefined;
  const channels: Record<string, Poster | undefined> = {
    'window.ipc': g.ipc as Poster | undefined,
    'webkit.messageHandlers.ipc': webkit?.messageHandlers?.ipc,
    'chrome.webview': chrome?.webview,
  };
  for (const [name, ch] of Object.entries(channels)) {
    if (typeof ch?.postMessage !== 'function') continue;
    info.push(`${name} present`);
    try {
      ch.postMessage(message);
    } catch {
      // refused: fine
    }
  }
  return 'blocked';
}

/** Asking the shell window directly, outside the SDK protocol. Rust judges this one. */
function parentPost(): Verdict {
  window.parent.postMessage({ cmd: 'fs_read', path: CANARY }, '*');
  return 'blocked';
}

/** Framing the shell itself and reaching into it. */
async function frameShell(): Promise<Verdict> {
  const verdicts = await Promise.all(
    ['tauri://localhost/', 'http://tauri.localhost/'].map(
      (src) =>
        new Promise<Verdict>((resolve) => {
          const frame = document.createElement('iframe');
          const judge = () => {
            try {
              const w = frame.contentWindow as unknown as Record<string, unknown> | null;
              const internals = w?.__TAURI_INTERNALS__;
              resolve(typeof internals === 'object' && internals !== null ? 'LEAK' : 'blocked');
            } catch {
              resolve('blocked');
            }
            frame.remove();
          };
          const timer = setTimeout(judge, TIMEOUT_MS);
          frame.addEventListener('load', () => {
            clearTimeout(timer);
            judge();
          });
          frame.src = src;
          document.body.append(frame);
        }),
    ),
  );
  return verdicts.includes('LEAK') ? 'LEAK' : 'blocked';
}

/** Opening the shell in a new window (the sandbox has no allow-popups). */
function popup(): Verdict {
  try {
    return window.open('tauri://localhost/') === null ? 'blocked' : 'LEAK';
  } catch {
    return 'blocked';
  }
}

const results: Record<string, Verdict> = {
  nativeChannels: nativeChannels(),
  parentPost: parentPost(),
  popup: popup(),
};
const [invokeVerdict, fetchVerdict, frameVerdict] = await Promise.all([
  internalsInvoke(),
  ipcFetch(),
  frameShell(),
]);
Object.assign(results, { internalsInvoke: invokeVerdict, ipcFetch: fetchVerdict, frameShell: frameVerdict });

const leaks = Object.entries(results)
  .filter(([, v]) => v === 'LEAK')
  .map(([k]) => k);
(document.querySelector('#status') as HTMLElement).textContent =
  leaks.length === 0 ? 'All IPC escape attempts were blocked.' : `LEAK: ${leaks.join(', ')}`;
(document.querySelector('#results') as HTMLElement).textContent = JSON.stringify(results);
(document.querySelector('#info') as HTMLElement).textContent = info.join('\n');
await os.window.setTitle(`RESULT ${leaks.length === 0 ? 'blocked' : `LEAK:${leaks.join(',')}`}`);
