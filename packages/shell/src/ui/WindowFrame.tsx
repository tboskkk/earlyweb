import type { ComponentChildren } from 'preact';
import type { Rect, WindowState, WindowStore } from '../state/windows.ts';
import { startDrag } from './drag.ts';

type Props = {
  win: WindowState;
  store: WindowStore;
  children: ComponentChildren;
  onCloseRequest(id: string): void;
  onEndTask(id: string): void;
};

const DIRS = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
type Dir = (typeof DIRS)[number];

function resized(dir: Dir, r: Rect, dx: number, dy: number, minW: number, minH: number): Rect {
  let { x, y, w, h } = r;
  if (dir.includes('e')) w = Math.max(r.w + dx, minW);
  if (dir.includes('s')) h = Math.max(r.h + dy, minH);
  if (dir.includes('w')) {
    w = Math.max(r.w - dx, minW);
    x = r.x + r.w - w;
  }
  if (dir.includes('n')) {
    h = Math.max(r.h - dy, minH);
    y = r.y + r.h - h;
  }
  return { x, y, w, h };
}

export function WindowFrame({ win, store, children, onCloseRequest, onEndTask }: Props) {
  const maximized = win.state === 'maximized';
  const hidden = !win.shown || win.state === 'minimized';
  const focused = store.focusedId.value === win.id;

  const dragTitle = (e: PointerEvent) => {
    if ((e.target as Element).closest('button') || maximized) return;
    const { x, y } = win;
    startDrag(e, (dx, dy) => store.move(win.id, x + dx, y + dy));
  };

  const dragHandle = (dir: Dir) => (e: PointerEvent) => {
    e.stopPropagation();
    store.focus(win.id);
    const start: Rect = { x: win.x, y: win.y, w: win.w, h: win.h };
    startDrag(e, (dx, dy) => store.resize(win.id, resized(dir, start, dx, dy, win.minW, win.minH)));
  };

  return (
    <div
      class={`ew-window${focused ? ' ew-focused' : ''}${maximized ? ' ew-maximized' : ''}`}
      style={{
        left: `${win.x}px`,
        top: `${win.y}px`,
        width: `${win.w}px`,
        height: `${win.h}px`,
        zIndex: win.z,
        visibility: hidden ? 'hidden' : 'visible',
      }}
      onPointerDown={() => store.focus(win.id)}
    >
      {/* biome-ignore lint/a11y/noStaticElementInteractions: titlebar is a pointer-only drag handle; buttons provide keyboard access */}
      <div
        class="ew-titlebar"
        onPointerDown={dragTitle}
        onDblClick={() => win.resizable && store.toggleMaximize(win.id)}
      >
        <span class="ew-title">
          {win.title}
          {win.notResponding ? ' (Not Responding)' : ''}
        </span>
        <button type="button" class="ew-win-btn" aria-label="Minimize" onClick={() => store.minimize(win.id)}>
          _
        </button>
        {win.resizable && (
          <button
            type="button"
            class="ew-win-btn"
            aria-label={maximized ? 'Restore' : 'Maximize'}
            onClick={() => store.toggleMaximize(win.id)}
          >
            {maximized ? '❐' : '□'}
          </button>
        )}
        <button
          type="button"
          class="ew-win-btn ew-close"
          aria-label="Close"
          onClick={() => onCloseRequest(win.id)}
        >
          ×
        </button>
      </div>
      <div class="ew-body">
        {children}
        {win.notResponding && (
          <button type="button" class="ew-btn ew-endtask" onClick={() => onEndTask(win.id)}>
            End Task
          </button>
        )}
      </div>
      {win.resizable &&
        !maximized &&
        DIRS.map((d) => <div key={d} class={`ew-handle ew-h-${d}`} onPointerDown={dragHandle(d)} />)}
    </div>
  );
}
