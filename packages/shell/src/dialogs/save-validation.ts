import type { FileFilter } from '@earlyweb/protocol';

export const MAX_NAME = 255;

export type SaveNameResult = { ok: true; name: string } | { ok: false; error: string };

const CONTROL = /\p{Cc}/u;
// Filter extensions are app-supplied: only short alphanumeric ones are ever used.
const SAFE_EXT = /^\.?[A-Za-z0-9_-]{1,16}$/;

/** '.txt' for a safe extension, '*' for a wildcard, null for anything else (ignored). */
export function normalizeExt(e: string): string | null {
  if (e === '*' || e === '.*') return '*';
  if (!SAFE_EXT.test(e)) return null;
  return e.startsWith('.') ? e : `.${e}`;
}

/** The safe extensions of a filter; empty means "show/accept everything". */
export function safeExts(extensions: string[] | undefined): string[] {
  const out: string[] = [];
  for (const e of extensions ?? []) {
    const n = normalizeExt(e);
    if (n === '*') return [];
    if (n) out.push(n);
  }
  return out;
}

function checkName(n: string): string | null {
  if (n === '') return 'Enter a file name.';
  if (n.includes('/') || n.includes('\\')) return 'A file name cannot contain / or \\.';
  if (CONTROL.test(n)) return 'A file name cannot contain control characters.';
  if (n === '.' || n === '..') return 'That is not a valid file name.';
  if (n.length > MAX_NAME) return `A file name can be at most ${MAX_NAME} characters.`;
  return null;
}

/**
 * Validates a user-typed save name. Trims it; rejects empty names, path
 * separators, '.', '..', control characters and names over 255 characters.
 * If the name has no extension at all, the first SAFE filter extension is
 * appended ('notes' -> 'notes.txt'); a name that already has any extension is
 * kept ('notes.md' stays 'notes.md' even when the filter is .txt). Unsafe
 * (app-supplied) extensions are ignored. The full checks re-run after appending.
 */
export function validateSaveName(name: string, filters?: FileFilter[]): SaveNameResult {
  let n = name.trim();
  const early = checkName(n);
  if (early) return { ok: false, error: early };

  const dot = n.lastIndexOf('.');
  const hasExt = dot > 0 && dot < n.length - 1;
  const first = filters?.[0] ? safeExts(filters[0].extensions)[0] : undefined;
  if (!hasExt && first) n = n.replace(/\.+$/, '') + first;
  const late = checkName(n);
  return late ? { ok: false, error: late } : { ok: true, name: n };
}
