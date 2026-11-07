import type { FsBackend } from '@earlyweb/backends';
import { useEffect, useRef } from 'preact/hooks';
import { CONFIRM_GUARD_MS, cancelDialog, type DialogRequest, type DialogService } from './dialog-service.ts';
import { FileDialog } from './FileDialog.tsx';
import { MessageBox } from './MessageBox.tsx';

let nextId = 0;
const ids = new WeakMap<DialogRequest, number>();
const idOf = (r: DialogRequest) => {
  let id = ids.get(r);
  if (id === undefined) {
    id = nextId++;
    ids.set(r, id);
  }
  return id;
};

const armed = (r: DialogRequest) => performance.now() - r.activatedAt >= CONFIRM_GUARD_MS;

export { cancelDialog };

export function ModalLayer({ dialogs, fs }: { dialogs: DialogService; fs: FsBackend }) {
  const req = dialogs.active.value;
  const box = useRef<HTMLDivElement>(null);

  // Focus the dialog when it opens and keep focus inside it while it is up.
  useEffect(() => {
    if (!req) return;
    const el = box.current;
    // Child effects (filename box, default button) have already run: keep their focus.
    if (el && !el.contains(document.activeElement)) el.focus();
    const onFocusIn = (e: FocusEvent) => {
      if (el && !el.contains(e.target as Node)) el.focus();
    };
    document.addEventListener('focusin', onFocusIn);
    return () => document.removeEventListener('focusin', onFocusIn);
  }, [req]);

  if (!req) return null;
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: backdrop only swallows pointer events
    <div
      class="ew-modal"
      onPointerDown={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault();
      }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div
        key={idOf(req)}
        class={`ew-dialog ew-dialog-${req.kind}`}
        role="dialog"
        aria-modal="true"
        aria-label={req.title}
        tabIndex={-1}
        ref={box}
        onKeyDownCapture={(e) => {
          // Keystroke-jacking guard: no Enter/Space confirmation right after opening. Escape is never delayed.
          if ((e.key === 'Enter' || e.key === ' ') && !armed(req)) {
            if (!(e.key === ' ' && (e.target as HTMLElement).tagName === 'INPUT')) {
              e.preventDefault();
              e.stopPropagation();
            }
          }
        }}
        onKeyUpCapture={(e) => {
          if (e.key === ' ' && !armed(req)) e.preventDefault();
        }}
        onClickCapture={(e) => {
          if (!armed(req)) {
            e.preventDefault();
            e.stopPropagation();
          }
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancelDialog(req);
          } else if (e.key === 'Tab') {
            const items = Array.from(
              (box.current as HTMLElement).querySelectorAll<HTMLElement>(
                'button:not([tabindex="-1"]), input, select, [tabindex="0"]',
              ),
            );
            const first = items[0];
            const last = items[items.length - 1];
            if (!first || !last) return;
            if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) {
              e.preventDefault();
              last.focus();
            } else if (!e.shiftKey && document.activeElement === last) {
              e.preventDefault();
              first.focus();
            }
          }
        }}
      >
        <div class="ew-dlg-title">{req.title}</div>
        {req.kind === 'message' ? <MessageBox req={req} /> : <FileDialog req={req} fs={fs} />}
        <div class="ew-dlg-from">From: {req.appName}</div>
      </div>
    </div>
  );
}
