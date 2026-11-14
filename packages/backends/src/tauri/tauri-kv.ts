import type { Kv } from '../kv.ts';
import { call, type Invoke } from './invoke.ts';

/** Saved state through the desktop app's `kv_*` commands. Rust's `None` arrives as `null`. */
export function createTauriKv(invoke: Invoke): Kv {
  return {
    async get<T>(key: string) {
      return ((await call<T | null>(invoke, 'kv_get', { key })) ?? undefined) as T | undefined;
    },
    async set(key, value) {
      await call(invoke, 'kv_set', { key, value });
    },
    async delete(key) {
      await call(invoke, 'kv_delete', { key });
    },
  };
}
