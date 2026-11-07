import { effect, type Signal, signal } from '@preact/signals';

export const TITLEBAR_H = 30;
export const TASKBAR_H = 40;
export const MIN_VISIBLE = 80;

export type Rect = { x: number; y: number; w: number; h: number };

export type WindowState = Rect & {
  id: string;
  appId: string;
  instanceId: string;
  title: string;
  icon: string;
  minW: number;
  minH: number;
  resizable: boolean;
  z: number;
  state: 'normal' | 'minimized' | 'maximized';
  restoreRect?: Rect;
  shown: boolean;
  notResponding: boolean;
};

export type OpenInit = {
  appId: string;
  instanceId: string;
  title: string;
  icon: string;
  w: number;
  h: number;
  minW: number;
  minH: number;
  resizable: boolean;
  rect?: Partial<Rect>;
};

export type WindowStore = {
  windows: Signal<WindowState[]>;
  focusedId: Signal<string | null>;
  open(init: OpenInit): string;
  close(id: string): void;
  focus(id: string): void;
  move(id: string, x: number, y: number): void;
  resize(id: string, rect: Rect): void;
  minimize(id: string): void;
  restore(id: string): void;
  toggleMaximize(id: string): void;
  update(id: string, patch: Partial<WindowState>): void;
};

type Viewport = { width: number; height: number };

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi));

function clampPos(x: number, y: number, w: number, vp: Viewport) {
  return {
    x: clamp(x, MIN_VISIBLE - w, vp.width - MIN_VISIBLE),
    y: clamp(y, 0, vp.height - TASKBAR_H - TITLEBAR_H),
  };
}

/**
 * The viewport effect lives for the lifetime of the store (the shell is a
 * single page whose store is never torn down), so no dispose is exposed.
 */
export function createWindowStore(viewport: Signal<Viewport>): WindowStore {
  const windows = signal<WindowState[]>([]);
  const focusedId = signal<string | null>(null);
  let opened = 0;
  let topZ = 0;

  const patch = (id: string, fn: (w: WindowState) => Partial<WindowState>) => {
    windows.value = windows.value.map((w) => (w.id === id ? { ...w, ...fn(w) } : w));
  };
  const find = (id: string) => windows.value.find((w) => w.id === id);
  const nextFocus = (): string | null => {
    let best: WindowState | undefined;
    for (const w of windows.value) {
      if (w.state !== 'minimized' && (!best || w.z > best.z)) best = w;
    }
    return best?.id ?? null;
  };

  effect(() => {
    const vp = viewport.value;
    windows.value = windows.peek().map((w) => {
      if (w.state === 'maximized') return { ...w, x: 0, y: 0, w: vp.width, h: vp.height - TASKBAR_H };
      return { ...w, ...clampPos(w.x, w.y, w.w, vp) };
    });
  });

  return {
    windows,
    focusedId,
    open(init) {
      const off = 40 + 24 * (opened++ % 10);
      const id = crypto.randomUUID();
      const r = init.rect ?? {};
      const vp = viewport.peek();
      const w = r.w ?? init.w;
      const pos = clampPos(r.x ?? off, r.y ?? off, w, vp);
      windows.value = [
        ...windows.peek(),
        {
          id,
          appId: init.appId,
          instanceId: init.instanceId,
          title: init.title,
          icon: init.icon,
          minW: init.minW,
          minH: init.minH,
          resizable: init.resizable,
          ...pos,
          w,
          h: r.h ?? init.h,
          z: ++topZ,
          state: 'normal',
          shown: false,
          notResponding: false,
        },
      ];
      focusedId.value = id;
      return id;
    },
    close(id) {
      windows.value = windows.value.filter((w) => w.id !== id);
      if (focusedId.value === id) focusedId.value = nextFocus();
    },
    focus(id) {
      if (!find(id)) return;
      patch(id, () => ({ z: ++topZ }));
      focusedId.value = id;
    },
    move(id, x, y) {
      patch(id, (w) => clampPos(x, y, w.w, viewport.peek()));
    },
    resize(id, rect) {
      patch(id, (w) =>
        w.resizable ? { ...rect, w: Math.max(rect.w, w.minW), h: Math.max(rect.h, w.minH) } : {},
      );
    },
    minimize(id) {
      patch(id, () => ({ state: 'minimized' }));
      if (focusedId.value === id) focusedId.value = nextFocus();
    },
    restore(id) {
      const w = find(id);
      if (!w) return;
      patch(id, (cur) => ({ state: cur.restoreRect ? 'maximized' : 'normal', z: ++topZ }));
      focusedId.value = id;
    },
    toggleMaximize(id) {
      const vp = viewport.peek();
      patch(id, (w) => {
        if (w.state === 'maximized' && w.restoreRect) {
          return { ...w.restoreRect, state: 'normal', restoreRect: undefined };
        }
        return {
          restoreRect: { x: w.x, y: w.y, w: w.w, h: w.h },
          x: 0,
          y: 0,
          w: vp.width,
          h: vp.height - TASKBAR_H,
          state: 'maximized',
        };
      });
    },
    update(id, p) {
      patch(id, () => p);
    },
  };
}
