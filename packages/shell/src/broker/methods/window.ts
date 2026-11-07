import type { MethodMap } from '@earlyweb/protocol';
import { toWindowSize } from '../../state/content-size.ts';
import { TASKBAR_H, type WindowStore } from '../../state/windows.ts';
import type { Handler } from '../broker.ts';

// Control characters and bidi override/isolate characters could spoof the titlebar.
const sanitizeTitle = (t: string) => t.replace(/[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu, '').trim();

/**
 * Every handler operates only on the caller's own window (ctx.instance.windowId);
 * no window id is ever taken from params. `deps.onClose` lets window.close share
 * the user's close path (launcher.close); without it the window is closed directly.
 */
export function windowHandlers(
  store: WindowStore,
  deps?: {
    onClose?(instanceId: string): void;
    /** When given, setSize clamps the window to the viewport above the taskbar. */
    getViewport?(): { width: number; height: number };
  },
): Partial<Record<keyof MethodMap, Handler>> {
  return {
    'window.setTitle': async (ctx, p: { title: string }) => {
      const title = sanitizeTitle(p.title);
      if (title) store.update(ctx.instance.windowId, { title });
      return null;
    },
    'window.setSize': async (ctx, p: { width: number; height: number }) => {
      const id = ctx.instance.windowId;
      const win = store.windows.peek().find((w) => w.id === id);
      if (!win) return null;
      let { w, h } = toWindowSize(p);
      const vp = deps?.getViewport?.();
      if (vp) {
        w = Math.min(w, vp.width);
        h = Math.min(h, vp.height - TASKBAR_H);
      }
      store.resize(id, { x: win.x, y: win.y, w, h });
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
      // A hidden window can't legitimately ping, and re-focusing the focused
      // window must not keep bumping z; only raising a visible one is allowed.
      const id = ctx.instance.windowId;
      const win = store.windows.peek().find((w) => w.id === id);
      if (!win || win.state === 'minimized' || store.focusedId.peek() === id) return null;
      store.focus(id);
      return null;
    },
  };
}
