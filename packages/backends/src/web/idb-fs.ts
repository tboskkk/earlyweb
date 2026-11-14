import { EwError } from '@earlyweb/protocol';
import { type IDBPObjectStore, openDB } from 'idb';
import { compareStat, type FsBackend, type FsStat } from '../fs.ts';
import { basename, dirname, isWithin, normalizePath } from '../path.ts';

interface NodeRecord {
  path: string;
  parent: string;
  name: string;
  kind: 'file' | 'dir';
  size: number;
  mtime: number;
  data?: ArrayBuffer;
}

type Store = IDBPObjectStore<unknown, ['nodes'], 'nodes', 'readwrite'>;

const toStat = (r: NodeRecord): FsStat => ({
  path: r.path,
  name: r.name,
  kind: r.kind,
  size: r.size,
  mtime: r.mtime,
});

// All keys strictly below `path` ('0' is the code point after '/').
const descendants = (path: string) =>
  IDBKeyRange.bound(path === '/' ? '/' : `${path}/`, path === '/' ? '0' : `${path}0`, true, true);

const dirRecord = (path: string): NodeRecord => ({
  path,
  parent: path === '/' ? '' : dirname(path),
  name: path === '/' ? '' : basename(path),
  kind: 'dir',
  size: 0,
  mtime: Date.now(),
});

export async function createIdbFs(dbName = 'earlyweb-fs'): Promise<FsBackend> {
  const db = await openDB(dbName, 1, {
    upgrade(d) {
      const s = d.createObjectStore('nodes', { keyPath: 'path' });
      s.createIndex('parent', 'parent');
      s.put(dirRecord('/'));
    },
  });
  const rw = () => db.transaction('nodes', 'readwrite');
  const get = (s: Store, p: string) => s.get(p) as Promise<NodeRecord | undefined>;

  async function mkdirIn(s: Store, p: string): Promise<void> {
    const chain: string[] = [];
    for (let cur = p; cur !== '/'; cur = dirname(cur)) chain.unshift(cur);
    for (const c of chain) {
      const existing = await get(s, c);
      if (existing?.kind === 'file') throw new EwError('EEXIST', `not a directory: ${c}`);
      if (!existing) await s.put(dirRecord(c));
    }
  }

  return {
    async stat(p) {
      const r = (await db.get('nodes', normalizePath(p))) as NodeRecord | undefined;
      return r ? toStat(r) : null;
    },

    async list(dir) {
      const d = normalizePath(dir);
      const root = (await db.get('nodes', d)) as NodeRecord | undefined;
      if (!root) throw new EwError('ENOENT', `no such directory: ${d}`);
      if (root.kind !== 'dir') throw new EwError('EINVAL', `not a directory: ${d}`);
      const kids = (await db.getAllFromIndex('nodes', 'parent', d)) as NodeRecord[];
      return kids.map(toStat).sort(compareStat);
    },

    async read(p) {
      const n = normalizePath(p);
      const r = (await db.get('nodes', n)) as NodeRecord | undefined;
      if (!r) throw new EwError('ENOENT', `no such file: ${n}`);
      if (r.kind !== 'file') throw new EwError('EINVAL', `is a directory: ${n}`);
      return new Blob([r.data ?? new ArrayBuffer(0)]);
    },

    async write(p, data) {
      const n = normalizePath(p);
      if (n === '/') throw new EwError('EINVAL', 'cannot write to /');
      const buf = await data.arrayBuffer();
      const tx = rw();
      const s = tx.objectStore('nodes');
      try {
        const parent = await get(s, dirname(n));
        if (!parent) throw new EwError('ENOENT', `no such directory: ${dirname(n)}`);
        if (parent.kind !== 'dir') throw new EwError('EINVAL', `not a directory: ${dirname(n)}`);
        const existing = await get(s, n);
        if (existing?.kind === 'dir') throw new EwError('EINVAL', `is a directory: ${n}`);
        await s.put({
          path: n,
          parent: dirname(n),
          name: basename(n),
          kind: 'file',
          size: buf.byteLength,
          mtime: Date.now(),
          data: buf,
        } satisfies NodeRecord);
      } catch (e) {
        tx.abort();
        await tx.done.catch(() => {});
        throw e;
      }
      await tx.done;
    },

    async mkdir(p) {
      const n = normalizePath(p);
      const tx = rw();
      try {
        await mkdirIn(tx.objectStore('nodes'), n);
      } catch (e) {
        tx.abort();
        await tx.done.catch(() => {});
        throw e;
      }
      await tx.done;
    },

    async remove(p) {
      const n = normalizePath(p);
      if (n === '/') throw new EwError('EINVAL', 'cannot remove /');
      const tx = rw();
      const s = tx.objectStore('nodes');
      try {
        if (!(await get(s, n))) throw new EwError('ENOENT', `no such path: ${n}`);
        await s.delete(n);
        await s.delete(descendants(n));
      } catch (e) {
        tx.abort();
        await tx.done.catch(() => {});
        throw e;
      }
      await tx.done;
    },

    async rename(from, to) {
      const f = normalizePath(from);
      const t = normalizePath(to);
      if (f === '/' || t === '/') throw new EwError('EINVAL', 'cannot rename /');
      if (isWithin(t, f)) {
        throw new EwError(f === t ? 'EEXIST' : 'EINVAL', `cannot move ${f} into itself`);
      }
      const tx = rw();
      const s = tx.objectStore('nodes');
      try {
        const src = await get(s, f);
        if (!src) throw new EwError('ENOENT', `no such path: ${f}`);
        if (await get(s, t)) throw new EwError('EEXIST', `already exists: ${t}`);
        const parent = await get(s, dirname(t));
        if (!parent) throw new EwError('ENOENT', `no such directory: ${dirname(t)}`);
        if (parent.kind !== 'dir') throw new EwError('EINVAL', `not a directory: ${dirname(t)}`);
        const kids = (await s.getAll(descendants(f))) as NodeRecord[];
        for (const r of [src, ...kids]) {
          await s.delete(r.path);
          const path = t + r.path.slice(f.length);
          await s.put({ ...r, path, parent: dirname(path), name: basename(path) });
        }
      } catch (e) {
        tx.abort();
        await tx.done.catch(() => {});
        throw e;
      }
      await tx.done;
    },
  };
}
