import { expect, test } from 'vitest';
import { loadCatalog } from '../src/state/catalog.ts';

const manifest = {
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
};

const jsonFetch = (body: unknown, ok = true) =>
  (async (url: string | URL | Request) => {
    expect(String(url)).toBe('http://127.0.0.1:5174/index.json');
    return new Response(JSON.stringify(body), { status: ok ? 200 : 500 });
  }) as typeof fetch;

test('resolves baseUrl against appOrigin and parses manifests', async () => {
  const entries = await loadCatalog(
    'http://127.0.0.1:5174',
    jsonFetch({ apps: [{ manifest, baseUrl: '/org.test.app/1.0.0/' }] }),
  );
  expect(entries).toHaveLength(1);
  expect(entries[0]?.baseUrl).toBe('http://127.0.0.1:5174/org.test.app/1.0.0/');
  expect(entries[0]?.manifest.id).toBe('org.test.app');
  expect(entries[0]?.manifest.category).toBe('accessories');
});

test('skips entries with invalid manifests', async () => {
  const entries = await loadCatalog(
    'http://127.0.0.1:5174',
    jsonFetch({
      apps: [
        { manifest: { id: 'x' }, baseUrl: '/x/1/' },
        { manifest, baseUrl: '/org.test.app/1.0.0/' },
      ],
    }),
  );
  expect(entries.map((e) => e.manifest.id)).toEqual(['org.test.app']);
});

test('rejects when the server responds with an error', async () => {
  await expect(loadCatalog('http://127.0.0.1:5174', jsonFetch({}, false))).rejects.toThrow();
});
