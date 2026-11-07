import type { FsBackend } from './fs.ts';

const DIRS = [
  '/home/user/Desktop',
  '/home/user/Documents',
  '/home/user/Music',
  '/home/user/Pictures',
  '/home/user/Downloads',
  '/apps',
  '/system',
];

export async function ensureHome(fs: FsBackend): Promise<void> {
  for (const d of DIRS) await fs.mkdir(d);
  if (await fs.stat('/tmp')) await fs.remove('/tmp');
  await fs.mkdir('/tmp');
}
