import { type Manifest, parseManifest } from '@earlyweb/protocol';

export type CatalogEntry = { manifest: Manifest; baseUrl: string };

export async function loadCatalog(appOrigin: string, fetchFn: typeof fetch = fetch): Promise<CatalogEntry[]> {
  const res = await fetchFn(new URL('/index.json', appOrigin));
  if (!res.ok) throw new Error(`catalog fetch failed: ${res.status}`);
  const body = (await res.json()) as { apps?: { manifest: unknown; baseUrl: string }[] };
  const entries: CatalogEntry[] = [];
  for (const app of body.apps ?? []) {
    try {
      entries.push({
        manifest: parseManifest(app.manifest),
        baseUrl: new URL(app.baseUrl, appOrigin).href,
      });
    } catch {
      // skip invalid entries
    }
  }
  return entries;
}
