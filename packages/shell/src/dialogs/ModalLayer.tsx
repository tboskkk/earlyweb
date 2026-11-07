import type { FsBackend } from '@earlyweb/backends';
import { useEffect, useRef } from 'preact/hooks';
import type { DialogRequest, DialogService } from './dialog-service.ts';
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

export function cancelDialog(req: DialogRequest): void {
  if (req.kind === 'message') {
    req.resolve(req.buttons.includes('Cancel') ? 'Cancel' : (req.buttons[req.buttons.length - 1] as string));
  } else req.resolve(null);
}

export function ModalLayer({ dialogs, fs }: { dialogs: DialogService; fs: FsBackend }) {
  const req = dialogs.active.value;
  const box = useRef<HTMLDivElement>(null);

  // Focus the dialog when it opens and keep focus inside it while it is up.
  useEffect(() => {
    if (!req) return;
    const el = box.current;
    el?.focus();
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
