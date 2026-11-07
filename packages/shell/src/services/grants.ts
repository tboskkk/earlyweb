import type { Kv } from '@earlyweb/backends';
import { basename } from '@earlyweb/backends';
import { EwError, type FileRef } from '@earlyweb/protocol';

export interface GrantTable {
  issue(appId: string, path: string): FileRef;
  resolve(appId: string, id: string): string;
  revokeApp(appId: string): void;
}

interface Grant {
  appId: string;
  path: string;
}

const KEY = 'grants';

function newId(): string {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return `g_${Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')}`;
}

export async function createGrantTable(kv: Kv): Promise<GrantTable> {
  const table = new Map<string, Grant>(Object.entries((await kv.get<Record<string, Grant>>(KEY)) ?? {}));
  // Serialize writes so the last change always wins in storage.
  let pending: Promise<void> = Promise.resolve();
  const persist = () => {
    const snapshot = Object.fromEntries(table);
    pending = pending.then(() => kv.set(KEY, snapshot)).catch(() => {});
  };

  return {
    issue(appId, path) {
      let id = newId();
      while (table.has(id)) id = newId();
      table.set(id, { appId, path });
      persist();
      return { id, name: basename(path) };
    },
    resolve(appId, id) {
      const g = table.get(id);
      // Same error for unknown id, wrong app, or revoked app: do not leak which.
      if (!g || g.appId !== appId) throw new EwError('EPERM', 'no such grant');
      return g.path;
    },
    revokeApp(appId) {
      for (const [id, g] of table) if (g.appId === appId) table.delete(id);
      persist();
    },
  };
}
