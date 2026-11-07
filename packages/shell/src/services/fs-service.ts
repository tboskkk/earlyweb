import { type FsBackend, type FsStat, isWithin, normalizePath } from '@earlyweb/backends';
import { EwError, type FsEntry } from '@earlyweb/protocol';
import type { GrantTable } from './grants.ts';

export const TEXT_LIMIT_BYTES = 5 * 1024 * 1024;

export interface FsService {
  resolveRef(appId: string, ref: string): string;
  readText(appId: string, ref: string): Promise<string>;
  writeText(appId: string, ref: string, text: string): Promise<null>;
  read(appId: string, ref: string): Promise<Blob>;
  write(appId: string, ref: string, data: Blob): Promise<null>;
  list(appId: string, ref: string): Promise<FsEntry[]>;
  stat(appId: string, ref: string): Promise<FsEntry | null>;
  mkdir(appId: string, ref: string): Promise<null>;
  remove(appId: string, ref: string): Promise<null>;
  rename(appId: string, from: string, to: string): Promise<null>;
}

const SELF = '/apps/self';

const toEntry = (s: FsStat): FsEntry => ({
  name: s.name,
  kind: s.kind,
  size: s.size,
  mtime: s.mtime,
});

export function createFsService(fs: FsBackend, grants: GrantTable): FsService {
  function resolveRef(appId: string, ref: string): string {
    if (ref.startsWith('g_')) return grants.resolve(appId, ref);
    let p: string;
    try {
      p = normalizePath(ref);
    } catch {
      // Malformed or root-escaping refs are out of scope, not an input error.
      throw new EwError('EPERM', 'path outside app scope');
    }
    if (!isWithin(p, SELF)) throw new EwError('EPERM', 'path outside app scope');
    return `/apps/${appId}${p.slice(SELF.length)}`;
  }

  const ensureAppDir = (appId: string) => fs.mkdir(`/apps/${appId}`);

  return {
    resolveRef,
    async readText(appId, ref) {
      const blob = await fs.read(resolveRef(appId, ref));
      if (blob.size > TEXT_LIMIT_BYTES) throw new EwError('EINVAL', 'file too large for readText');
      return new TextDecoder().decode(await blob.arrayBuffer());
    },
    async writeText(appId, ref, text) {
      const p = resolveRef(appId, ref);
      await ensureAppDir(appId);
      await fs.write(p, new Blob([new TextEncoder().encode(text)]));
      return null;
    },
    read: (appId, ref) => fs.read(resolveRef(appId, ref)),
    async write(appId, ref, data) {
      const p = resolveRef(appId, ref);
      await ensureAppDir(appId);
      await fs.write(p, data);
      return null;
    },
    async list(appId, ref) {
      return (await fs.list(resolveRef(appId, ref))).map(toEntry);
    },
    async stat(appId, ref) {
      const s = await fs.stat(resolveRef(appId, ref));
      return s ? toEntry(s) : null;
    },
    async mkdir(appId, ref) {
      const p = resolveRef(appId, ref);
      await ensureAppDir(appId);
      await fs.mkdir(p);
      return null;
    },
    async remove(appId, ref) {
      await fs.remove(resolveRef(appId, ref));
      return null;
    },
    async rename(appId, from, to) {
      const f = resolveRef(appId, from);
      const t = resolveRef(appId, to);
      await ensureAppDir(appId);
      await fs.rename(f, t);
      return null;
    },
  };
}
