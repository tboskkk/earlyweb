import { cpSync, existsSync, readFileSync } from 'node:fs';
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

  const copyAssets: Plugin = {
    name: 'earlyweb-copy-assets',
    apply: 'build',
    closeBundle() {
      cpSync(manifestPath, path.join(outDir, 'earlyweb.json'));
      const icons = path.join(dir, 'icons');
      if (existsSync(icons)) cpSync(icons, path.join(outDir, 'icons'), { recursive: true });
    },
  };

  return {
    root: dir,
    base: './',
    plugins: [copyAssets],
    build: { outDir, emptyOutDir: true },
  };
}
