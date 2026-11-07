import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { appCsp, parseManifest } from '@earlyweb/protocol';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { createAppServer } from '../src/server.ts';

const SHELL = 'http://localhost:5173';
const manifestJson = {
  manifestVersion: 1,
  id: 'org.test.app',
  name: 'Test',
  version: '1.0.0',
  description: 'd',
  author: { name: 'a' },
  license: 'MIT',
  sdk: '^1.0.0',
  entry: 'index.html',
  icons: { '16': 'icons/16.png' },
  permissions: [],
  network: ['api.example.com'],
};

let tmp: string;
let root: string;
let base: string;
let server: ReturnType<typeof createAppServer>;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'ew-app-server-'));
  root = join(tmp, 'apps');
  const dir = join(root, 'org.test.app', '1.0.0');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'earlyweb.json'), JSON.stringify(manifestJson));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>x</title>');
  writeFileSync(join(dir, 'main.js'), 'export {}');
  writeFileSync(join(dir, 'data.bin'), 'zz');
  const bad = join(root, 'org.bad.app', '1.0.0');
  mkdirSync(bad, { recursive: true });
  writeFileSync(join(bad, 'earlyweb.json'), '{"id": "nope"}');
  const broken = join(root, 'org.broken.app', '1.0.0');
  mkdirSync(broken, { recursive: true });
  writeFileSync(join(broken, 'earlyweb.json'), '{not json');
  writeFileSync(join(tmp, 'secret'), 'top secret');
  symlinkSync(join(tmp, 'secret'), join(dir, 'link-out'));
  server = createAppServer({ root, shellOrigin: SHELL });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  rmSync(tmp, { recursive: true, force: true });
});

// fetch normalizes dot segments, so send raw request targets via http.
async function raw(path: string, method = 'GET') {
  const http = await import('node:http');
  return new Promise<{ status: number; headers: Record<string, unknown>; body: string }>(
    (resolve, reject) => {
      const u = new URL(base);
      const req = http.request({ host: u.hostname, port: u.port, path, method }, (res) => {
        let body = '';
        res.on('data', (c) => {
          body += c;
        });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      });
      req.on('error', reject);
      req.end();
    },
  );
}

describe('index.json', () => {
  test('lists valid apps only, with relative baseUrl and CORS', async () => {
    const res = await fetch(`${base}/index.json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as { apps: { manifest: { id: string }; baseUrl: string }[] };
    expect(body.apps).toHaveLength(1);
    expect(body.apps[0]?.manifest.id).toBe('org.test.app');
    expect(body.apps[0]?.baseUrl).toBe('/org.test.app/1.0.0/');
  });
});

describe('static files', () => {
  test('html gets the app CSP and nosniff', async () => {
    const res = await fetch(`${base}/org.test.app/1.0.0/index.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-security-policy')).toBe(appCsp(parseManifest(manifestJson), SHELL));
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
  });

  test('js has javascript type, ACAO and no CSP', async () => {
    const res = await fetch(`${base}/org.test.app/1.0.0/main.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/javascript');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('content-security-policy')).toBeNull();
    expect(await res.text()).toBe('export {}');
  });

  test('unknown extension is octet-stream', async () => {
    const res = await fetch(`${base}/org.test.app/1.0.0/data.bin`);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
  });

  test('HEAD works, other methods are 405', async () => {
    const head = await raw('/org.test.app/1.0.0/main.js', 'HEAD');
    expect(head.status).toBe(200);
    expect(head.body).toBe('');
    for (const m of ['POST', 'PUT', 'DELETE']) {
      const r = await raw('/org.test.app/1.0.0/main.js', m);
      expect(r.status).toBe(405);
      expect(r.headers['x-content-type-options']).toBe('nosniff');
    }
  });

  test('missing file and directories are 404 (no listings)', async () => {
    expect((await raw('/org.test.app/1.0.0/nope.js')).status).toBe(404);
    expect((await raw('/org.test.app/1.0.0/')).status).toBe(404);
    expect((await raw('/org.test.app/')).status).toBe(404);
    expect((await raw('/')).status).toBe(404);
  });

  test('symlink escaping root is 404', async () => {
    expect((await raw('/org.test.app/1.0.0/link-out')).status).toBe(404);
  });
});

describe('traversal', () => {
  const paths = [
    '/org.test.app/1.0.0/../../secret',
    '/org.test.app/1.0.0/%2e%2e/%2e%2e/secret',
    '/org.test.app/1.0.0/%2E%2E/%2E%2E/secret',
    '/org.test.app/1.0.0/..%2f..%2fsecret',
    '/org.test.app/1.0.0/%2e%2e%2f%2e%2e%2fsecret',
    '/org.test.app/1.0.0/%252e%252e%252f%252e%252e%252fsecret',
    '/org.test.app/1.0.0/..\\..\\secret',
    '/org.test.app/1.0.0/..%5c..%5csecret',
    '/org.test.app/1.0.0/main.js%00.png',
    '/org.test.app/1.0.0//etc/passwd',
    '/etc/passwd',
    '/..%2fsecret',
    '/%2e%2e/secret',
    '//etc/passwd',
  ];
  for (const p of paths) {
    test(`rejects ${p}`, async () => {
      const r = await raw(p);
      expect([400, 404]).toContain(r.status);
      expect(r.body).not.toContain('top secret');
      expect(r.body).not.toContain('root:');
    });
  }

  test('malformed percent escapes do not crash the server', async () => {
    const r = await raw('/org.test.app/1.0.0/%E0%A4%A');
    expect([400, 404]).toContain(r.status);
    expect((await fetch(`${base}/index.json`)).status).toBe(200);
  });
});
