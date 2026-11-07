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
