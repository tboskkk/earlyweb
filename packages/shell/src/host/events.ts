import type { EventMap } from '@earlyweb/protocol';
import { effect } from '@preact/signals';
import { toContentSize } from '../state/content-size.ts';
import type { WindowStore } from '../state/windows.ts';

type Emitter = { emit<K extends keyof EventMap>(name: K, data: EventMap[K]): void };

/**
 * Forwards focus/blur (on store.focusedId changes) and resize (content size,
 * on window size changes) to the app owning each window. Returns a disposer.
 */
export function forwardWindowEvents(
  store: WindowStore,
  connFor: (windowId: string) => Emitter | undefined,
): () => void {
  let prevFocus: string | null = null;
  const stopFocus = effect(() => {
    const next = store.focusedId.value;
    const prev = prevFocus;
    prevFocus = next;
    if (prev === next) return;
    if (prev) connFor(prev)?.emit('blur', null);
    if (next) connFor(next)?.emit('focus', null);
  });

  const sizes = new Map<string, { w: number; h: number }>();
  const stopResize = effect(() => {
    const seen = new Set<string>();
    for (const w of store.windows.value) {
      seen.add(w.id);
      const last = sizes.get(w.id);
      sizes.set(w.id, { w: w.w, h: w.h });
      if (last && (last.w !== w.w || last.h !== w.h)) connFor(w.id)?.emit('resize', toContentSize(w));
    }
    for (const id of sizes.keys()) if (!seen.has(id)) sizes.delete(id);
  });
  return () => {
    stopFocus();
    stopResize();
  };
}

/** Fallback for clicks inside an app iframe, which the shell sees only as a window blur. */
export function focusWindowOfActiveFrame(
  store: WindowStore,
  active: { contentWindow?: unknown } | null,
  windowIdOfFrame: (frame: unknown) => string | undefined,
): void {
  const frame = active?.contentWindow;
  if (frame == null) return;
  const id = windowIdOfFrame(frame);
  if (id) store.focus(id);
}
