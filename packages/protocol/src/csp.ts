import type { Manifest } from './manifest.ts';

export function appCsp(manifest: Manifest, shellOrigin: string): string {
  const connect = ["'self'", ...manifest.network.map((h) => `https://${h}`)].join(' ');
  return [
    "default-src 'self'",
    "script-src 'self' 'wasm-unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    `connect-src ${connect}`,
    `frame-ancestors ${shellOrigin}`,
  ].join('; ');
}
