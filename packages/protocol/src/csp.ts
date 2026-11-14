import type { Manifest } from './manifest.ts';

/**
 * The per-app CSP. `appBase` is the app's own folder URL, e.g.
 * `ewapp://localhost/org.earlyweb.notepad/0.1.0/`. It sits next to every `'self'`
 * because apps run in an opaque-origin sandbox, where WebKit's `'self'` matches nothing.
 * Must stay byte-identical to `src-tauri/core/src/csp.rs` (see test/fixtures/csp-cases.json).
 */
export function appCsp(manifest: Manifest, shellOrigin: string, appBase: string): string {
  const self = `'self' ${appBase}`;
  const connect = [self, ...manifest.network.map((h) => `https://${h}`)].join(' ');
  return [
    `default-src ${self}`,
    `script-src ${self} 'wasm-unsafe-eval'`,
    `style-src ${self} 'unsafe-inline'`,
    `img-src ${self} data: blob:`,
    `media-src ${self} blob:`,
    `connect-src ${connect}`,
    `frame-ancestors ${shellOrigin}`,
  ].join('; ');
}
