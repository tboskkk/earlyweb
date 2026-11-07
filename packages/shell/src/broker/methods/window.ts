import type { MethodMap } from '@earlyweb/protocol';
import { toWindowSize } from '../../state/content-size.ts';
import type { WindowStore } from '../../state/windows.ts';
import type { Handler } from '../broker.ts';

/**
 * Every handler operates only on the caller's own window (ctx.instance.windowId);
 * no window id is ever taken from params. `deps.onClose` lets window.close share
 * the user's close path (launcher.close); without it the window is closed directly.
 */
export function windowHandlers(
  store: WindowStore,
  deps?: { onClose?(instanceId: string): void },
): Partial<Record<keyof MethodMap, Handler>> {
  return {
    'window.setTitle': async (ctx, p: { title: string }) => {
      store.update(ctx.instance.windowId, { title: p.title });
      return null;
    },
    'window.setSize': async (ctx, p: { width: number; height: number }) => {
      const id = ctx.instance.windowId;
      const win = store.windows.peek().find((w) => w.id === id);
      if (win) store.resize(id, { x: win.x, y: win.y, ...toWindowSize(p) });
      return null;
    },
    'window.close': async (ctx) => {
      if (deps?.onClose) deps.onClose(ctx.instance.instanceId);
      else store.close(ctx.instance.windowId);
      return null;
    },
    'window.minimize': async (ctx) => {
      store.minimize(ctx.instance.windowId);
      return null;
    },
    'window.focus': async (ctx) => {
      store.focus(ctx.instance.windowId);
      return null;
    },
  };
}
