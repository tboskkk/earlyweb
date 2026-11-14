import { ERROR_CODES, type ErrorCode, EwError } from '@earlyweb/protocol';

/**
 * The shape of `invoke` from `@tauri-apps/api/core`, injected so these backends stay
 * testable without Tauri. A `Uint8Array` body is sent raw (no JSON).
 */
export type Invoke = (
  cmd: string,
  args?: Record<string, unknown> | Uint8Array,
  options?: { headers: Record<string, string> },
) => Promise<unknown>;

const isCode = (c: unknown): c is ErrorCode => (ERROR_CODES as readonly unknown[]).includes(c);

/** Turns a rejected command (Rust's serialized `FsError`, or anything else) into an `EwError`. */
export function toEwError(e: unknown): EwError {
  if (e instanceof EwError) return e;
  if (typeof e === 'object' && e !== null && 'code' in e && isCode(e.code)) {
    const message = 'message' in e && typeof e.message === 'string' ? e.message : e.code;
    return new EwError(e.code, message);
  }
  return new EwError('EINVAL', String(e));
}

/** Calls `invoke`, rethrowing any failure as an `EwError`. */
export async function call<T>(invoke: Invoke, ...args: Parameters<Invoke>): Promise<T> {
  try {
    return (await invoke(...args)) as T;
  } catch (e) {
    throw toEwError(e);
  }
}
