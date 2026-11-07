import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { parseManifest } from '@earlyweb/protocol';
import type { Plugin, UserConfig } from 'vite';

/** Vite config for an EarlyWeb app: builds to <repo>/dist/apps/<id>/<version>/. */
export function defineAppConfig(appDir: string): UserConfig {
  const dir = path.resolve(appDir);
  const manifestPath = path.join(dir, 'earlyweb.json');
  const manifest = parseManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const repoRoot = path.resolve(import.meta.dirname, '..', '..');
  const outDir = path.join(repoRoot, 'dist', 'apps', manifest.id, manifest.version);

  const emitAssets: Plugin = {
    name: 'earlyweb-emit-assets',
    apply: 'build',
    buildStart() {
      this.addWatchFile(manifestPath);
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'earlyweb.json', source: readFileSync(manifestPath) });
      const icons = path.join(dir, 'icons');
      if (!existsSync(icons)) return;
      for (const f of readdirSync(icons, { recursive: true, withFileTypes: true })) {
        if (!f.isFile()) continue;
        const full = path.join(f.parentPath, f.name);
        this.addWatchFile(full);
        const rel = path.relative(dir, full).split(path.sep).join('/');
        this.emitFile({ type: 'asset', fileName: rel, source: readFileSync(full) });
      }
    },
  };

  return {
    root: dir,
    base: './',
    plugins: [emitAssets],
    build: { outDir, emptyOutDir: true, target: 'esnext' },
  };
}
