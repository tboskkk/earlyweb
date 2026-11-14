import { expect, test } from 'vitest';
import { appCsp, parseManifest } from '../src/index.ts';
import goldenCases from './fixtures/csp-cases.json' with { type: 'json' };

const valid = {
  manifestVersion: 1,
  id: 'org.earlyweb.notepad',
  name: 'Notepad',
  version: '0.1.0',
  description: 'x',
  author: { name: 'EarlyWeb' },
  license: 'MIT',
  sdk: '^0.1.0',
  entry: 'index.html',
  icons: { '16': 'icons/16.svg' },
  permissions: ['fs.dialog'],
};

const BASE = 'http://127.0.0.1:5174/org.earlyweb.notepad/0.1.0/';

test('offline app', () => {
  expect(appCsp(parseManifest(valid), 'http://localhost:5173', BASE)).toBe(
    `default-src 'self' ${BASE}; script-src 'self' ${BASE} 'wasm-unsafe-eval'; ` +
      `style-src 'self' ${BASE} 'unsafe-inline'; img-src 'self' ${BASE} data: blob:; ` +
      `media-src 'self' ${BASE} blob:; connect-src 'self' ${BASE}; frame-ancestors http://localhost:5173`,
  );
});

// WebKit derives 'self' from the sandboxed iframe's opaque origin, where it matches
// nothing; naming the app's own folder is what lets its files load there.
test('every self source also names the app folder', () => {
  const csp = appCsp(parseManifest(valid), 'http://localhost:5173', BASE);
  for (const d of csp.split('; ').filter((d) => d.includes("'self'"))) {
    expect(d, d).toContain(`'self' ${BASE}`);
  }
});

test('network hosts become https connect-src', () => {
  const m = parseManifest({ ...valid, network: ['api.example.com', '*.cdn.example.org'] });
  expect(appCsp(m, 'http://localhost:5173', BASE)).toContain(
    `connect-src 'self' ${BASE} https://api.example.com https://*.cdn.example.org;`,
  );
});

type CspCase = { name: string; network: string[]; shellOrigin: string; appBase: string; csp: string };
// Shared with the Rust port (src-tauri/core/tests/protocol.rs): neither side may drift.
const cases: CspCase[] = goldenCases;

test('golden cases match appCsp', () => {
  expect(cases.length).toBeGreaterThanOrEqual(3);
  for (const c of cases) {
    const m = parseManifest({ ...valid, network: c.network });
    expect(appCsp(m, c.shellOrigin, c.appBase), c.name).toBe(c.csp);
  }
});
