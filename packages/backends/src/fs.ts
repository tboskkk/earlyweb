export interface FsStat {
  path: string;
  name: string;
  kind: 'file' | 'dir';
  size: number;
  mtime: number;
}

export interface FsBackend {
  stat(p: string): Promise<FsStat | null>;
  list(dir: string): Promise<FsStat[]>;
  read(p: string): Promise<Blob>;
  write(p: string, data: Blob): Promise<void>;
  mkdir(p: string): Promise<void>;
  remove(p: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
}

/** Listing order shared by every backend: folders first, then by name (code-unit order). */
export function compareStat(a: FsStat, b: FsStat): number {
  if (a.kind !== b.kind) return a.kind === 'dir' ? -1 : 1;
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}
