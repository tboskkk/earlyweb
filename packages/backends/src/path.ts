import { EwError } from '@earlyweb/protocol';

export function normalizePath(p: string): string {
  if (!p.startsWith('/')) throw new EwError('EINVAL', `path must be absolute: ${p}`);
  const out: string[] = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      if (out.length === 0) throw new EwError('EINVAL', `path escapes root: ${p}`);
      out.pop();
    } else {
      out.push(seg);
    }
  }
  return `/${out.join('/')}`;
}

export function dirname(p: string): string {
  const n = normalizePath(p);
  const i = n.lastIndexOf('/');
  return i <= 0 ? '/' : n.slice(0, i);
}

export function basename(p: string): string {
  const n = normalizePath(p);
  return n.slice(n.lastIndexOf('/') + 1);
}

export function joinPath(...parts: string[]): string {
  return normalizePath(`/${parts.join('/')}`);
}

export function isWithin(path: string, root: string): boolean {
  const p = normalizePath(path);
  const r = normalizePath(root);
  if (r === '/') return true;
  return p === r || p.startsWith(`${r}/`);
}
