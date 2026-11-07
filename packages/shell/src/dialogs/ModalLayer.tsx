import type { FsBackend } from '@earlyweb/backends';
import { useEffect, useRef } from 'preact/hooks';
import { armed, cancelDialog, type DialogRequest, type DialogService } from './dialog-service.ts';
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
            const t = e.target as HTMLElement;
            // Typing a space in the filename box is fine; Enter there is fine once the user has edited it.
            const typing = t.tagName === 'INPUT' && (e.key === ' ' || t.dataset.edited === '1');
            if (!typing) {
              e.preventDefault();
              e.stopPropagation();
            }
          }
        }}
        onKeyUpCapture={(e) => {
          if (e.key === ' ' && !armed(req)) e.preventDefault();
        }}
        onDblClickCapture={(e) => {
          if (!armed(req)) {
            e.preventDefault();
            e.stopPropagation();
          }
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
