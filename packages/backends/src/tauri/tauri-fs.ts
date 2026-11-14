import { EwError } from '@earlyweb/protocol';
import { compareStat, type FsBackend, type FsStat } from '../fs.ts';
import { normalizePath } from '../path.ts';
import { call, type Invoke } from './invoke.ts';

/** File access through the desktop app's `fs_*` commands (see `src-tauri/src/commands.rs`). */
export function createTauriFs(invoke: Invoke): FsBackend {
  const run = <T>(cmd: string, args: Record<string, unknown>) => call<T>(invoke, cmd, args);
  return {
    stat: async (p) => run<FsStat | null>('fs_stat', { path: normalizePath(p) }),
    list: async (dir) => (await run<FsStat[]>('fs_list', { path: normalizePath(dir) })).sort(compareStat),
    async read(p) {
      const body = await run<unknown>('fs_read', { path: normalizePath(p) });
      if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return new Blob([body as BlobPart]);
      throw new EwError('EINVAL', 'fs_read returned no bytes');
    },
    async write(p, data) {
      const path = normalizePath(p);
      const bytes = new Uint8Array(await data.arrayBuffer());
      await call(invoke, 'fs_write', bytes, { headers: { 'x-ew-path': encodeURIComponent(path) } });
    },
    mkdir: async (p) => run('fs_mkdir', { path: normalizePath(p) }),
    remove: async (p) => run('fs_remove', { path: normalizePath(p) }),
    rename: async (from, to) => run('fs_rename', { from: normalizePath(from), to: normalizePath(to) }),
  };
}
