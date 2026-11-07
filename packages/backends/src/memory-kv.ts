import type { Kv } from './kv.ts';

export function createMemoryKv(): Kv {
  const m = new Map<string, unknown>();
  return {
    async get<T>(key: string) {
      return m.get(key) as T | undefined;
    },
    async set(key, value) {
      m.set(key, value);
    },
    async delete(key) {
      m.delete(key);
    },
  };
}
