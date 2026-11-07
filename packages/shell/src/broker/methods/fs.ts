import { type ErrorCode, EwError, type MethodMap } from '@earlyweb/protocol';
import type { FsService } from '../../services/fs-service.ts';
import type { Handler } from '../broker.ts';

// Backend messages can embed real resolved paths; apps only ever see these.
const GENERIC: Partial<Record<ErrorCode, string>> = {
  EPERM: 'Permission denied',
  ENOENT: 'No such file or directory',
  EEXIST: 'Already exists',
  EINVAL: 'Invalid argument',
  EQUOTA: 'Quota exceeded',
};

async function scrub<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    if (err instanceof EwError) throw new EwError(err.code, GENERIC[err.code] ?? 'Operation failed');
    throw err;
  }
}

export function fsHandlers(fs: FsService): Partial<Record<keyof MethodMap, Handler>> {
  type R = { ref: string };
  return {
    'fs.readText': (ctx, p: R) => scrub(() => fs.readText(ctx.instance.appId, p.ref)),
    'fs.writeText': (ctx, p: R & { text: string }) =>
      scrub(() => fs.writeText(ctx.instance.appId, p.ref, p.text)),
    'fs.read': (ctx, p: R) => scrub(() => fs.read(ctx.instance.appId, p.ref)),
    'fs.write': (ctx, p: R & { data: Blob }) => scrub(() => fs.write(ctx.instance.appId, p.ref, p.data)),
    'fs.list': (ctx, p: R) => scrub(() => fs.list(ctx.instance.appId, p.ref)),
    'fs.stat': (ctx, p: R) => scrub(() => fs.stat(ctx.instance.appId, p.ref)),
    'fs.mkdir': (ctx, p: R) => scrub(() => fs.mkdir(ctx.instance.appId, p.ref)),
    'fs.remove': (ctx, p: R) => scrub(() => fs.remove(ctx.instance.appId, p.ref)),
    'fs.rename': (ctx, p: { from: string; to: string }) =>
      scrub(() => fs.rename(ctx.instance.appId, p.from, p.to)),
  };
}
