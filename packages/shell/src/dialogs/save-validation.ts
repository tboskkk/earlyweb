import type { FileFilter } from '@earlyweb/protocol';

export const MAX_NAME = 255;

export type SaveNameResult = { ok: true; name: string } | { ok: false; error: string };

const CONTROL = /\p{Cc}/u;

/**
 * Validates a user-typed save name. Trims it; rejects empty names, path
 * separators, '.', '..', control characters and names over 255 characters.
 * If the name has no extension at all, the first filter extension is appended
 * ('notes' -> 'notes.txt'); a name that already has any extension is kept
 * ('notes.md' stays 'notes.md' even when the filter is .txt).
 */
export function validateSaveName(name: string, filters?: FileFilter[]): SaveNameResult {
  let n = name.trim();
  if (n === '') return { ok: false, error: 'Enter a file name.' };
  if (n.includes('/') || n.includes('\\')) return { ok: false, error: 'A file name cannot contain / or \\.' };
  if (CONTROL.test(n)) return { ok: false, error: 'A file name cannot contain control characters.' };
  if (n === '.' || n === '..') return { ok: false, error: 'That is not a valid file name.' };

  const dot = n.lastIndexOf('.');
  const hasExt = dot > 0 && dot < n.length - 1;
  const first = filters?.[0]?.extensions[0];
  if (!hasExt && first && first !== '*' && first !== '.*') {
    n = n.replace(/\.+$/, '') + (first.startsWith('.') ? first : `.${first}`);
  }
  if (n.length > MAX_NAME) return { ok: false, error: `A file name can be at most ${MAX_NAME} characters.` };
  return { ok: true, name: n };
}
