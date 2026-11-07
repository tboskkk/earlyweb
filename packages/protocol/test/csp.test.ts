import { expect, test } from 'vitest';
import { appCsp, parseManifest } from '../src/index.ts';

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

test('offline app', () => {
  expect(appCsp(parseManifest(valid), 'http://localhost:5173')).toBe(
    "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; " +
      "img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors http://localhost:5173",
  );
});

test('network hosts become https connect-src', () => {
  const m = parseManifest({ ...valid, network: ['api.example.com', '*.cdn.example.org'] });
  expect(appCsp(m, 'http://localhost:5173')).toContain(
    "connect-src 'self' https://api.example.com https://*.cdn.example.org;",
  );
});
