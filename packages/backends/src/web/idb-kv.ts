import { openDB } from 'idb';
import type { Kv } from '../kv.ts';

export async function createIdbKv(dbName = 'earlyweb-state'): Promise<Kv> {
  const db = await openDB(dbName, 1, {
    upgrade(d) {
      d.createObjectStore('kv');
    },
  });
  return {
    async get<T>(key: string) {
      return (await db.get('kv', key)) as T | undefined;
    },
    async set(key, value) {
      await db.put('kv', value, key);
    },
    async delete(key) {
      await db.delete('kv', key);
    },
  };
}
