import { EwError, type FileFilter } from '@earlyweb/protocol';
import { type Signal, signal } from '@preact/signals';

export const DEFAULT_DIR = '/home/user/Documents';

export type DialogIcon = 'info' | 'warning' | 'error' | 'question';

type Base = {
  appName: string;
  title: string;
  /** The requesting app instance (undefined for shell-originated dialogs). */
  instanceId?: string;
  /** performance.now() when the dialog became active; confirmation is ignored briefly after. */
  activatedAt: number;
};
export type OpenRequest = Base & {
  kind: 'open';
  filters: FileFilter[];
  multiple: boolean;
  resolve(paths: string[] | null): void;
};
export type SaveRequest = Base & {
  kind: 'save';
  filters: FileFilter[];
  suggestedName: string;
  resolve(path: string | null): void;
};
export type MessageRequest = Base & {
  kind: 'message';
  text: string;
  icon: DialogIcon;
  buttons: string[];
  defaultButton: string;
  resolve(label: string): void;
};
export type DialogRequest = OpenRequest | SaveRequest | MessageRequest;

// `appName` names the app that is asking; the shell draws it in the dialog chrome.
export type DialogService = {
  active: Signal<DialogRequest | null>;
  openFile(opts: {
    filters?: FileFilter[];
    multiple?: boolean;
    title: string;
    appName?: string;
    instanceId?: string;
  }): Promise<string[] | null>;
  saveFile(opts: {
    suggestedName?: string;
    filters?: FileFilter[];
    title: string;
    appName?: string;
    instanceId?: string;
  }): Promise<string | null>;
  message(opts: {
    title: string;
    text: string;
    icon?: DialogIcon;
    buttons?: string[];
    defaultButton?: string;
    appName?: string;
    instanceId?: string;
  }): Promise<string>;
  /** Cancels the instance's queued dialogs and dismisses its active one (call when the instance ends). */
  cancelFor(instanceId: string): void;
};

/** Pending (queued + active) dialogs allowed per requesting instance. */
export const MAX_PENDING_PER_INSTANCE = 3;
/** Enter/Space/click confirmation is ignored this long after a dialog becomes active. */
export const CONFIRM_GUARD_MS = 400;
const MAX_TEXT = 2000;

/** True once the confirmation guard window after activation has passed. */
export const armed = (r: DialogRequest): boolean => performance.now() - r.activatedAt >= CONFIRM_GUARD_MS;

// Control and bidi override/isolate characters could spoof the dialog chrome.
const UNSAFE = /[\p{Cc}‪-‮⁦-⁩]/gu;
/** Message body: strips control (except newline/tab) and bidi characters, caps the length. */
export function sanitizeText(s: string): string {
  const clean = s.replace(/[\p{Cc}\u202A-\u202E\u2066-\u2069]/gu, (c) => (c === '\n' || c === '\t' ? c : ''));
  return clean.length > MAX_TEXT ? `${clean.slice(0, MAX_TEXT - 1)}\u2026` : clean;
}

/** Resolves a dialog as cancelled: open/save -> null; message -> 'Cancel' if present else the last button. */
export function cancelDialog(req: DialogRequest): void {
  if (req.kind === 'message') {
    req.resolve(req.buttons.includes('Cancel') ? 'Cancel' : (req.buttons[req.buttons.length - 1] as string));
  } else req.resolve(null);
}

export function sanitizeLabel(s: string, max = 80): string {
  const clean = s.replace(UNSAFE, '').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/** Queue of trusted dialogs: FIFO, one active at a time, capped per requesting instance. */
export function createDialogService(): DialogService {
  const active = signal<DialogRequest | null>(null);
  const queue: DialogRequest[] = [];

  const activate = (req: DialogRequest | null) => {
    if (req) req.activatedAt = performance.now();
    active.value = req;
  };
  const advance = () => activate(queue.shift() ?? null);
  const pendingFor = (id: string) =>
    queue.filter((r) => r.instanceId === id).length + (active.peek()?.instanceId === id ? 1 : 0);
  const enqueue = (req: DialogRequest, reject: (e: unknown) => void) => {
    if (req.instanceId !== undefined && pendingFor(req.instanceId) >= MAX_PENDING_PER_INSTANCE) {
      reject(new EwError('ERATE', 'Too many dialogs'));
      return;
    }
    if (active.peek()) queue.push(req);
    else activate(req);
  };
  // Wraps a resolver so it fires once and then activates the next dialog.
  const once = <T>(res: (v: T) => void, getReq: () => DialogRequest) => {
    let done = false;
    return (v: T) => {
      if (done) return;
      done = true;
      res(v);
      if (active.peek() === getReq()) advance();
    };
  };
  const base = (o: { title: string; appName?: string; instanceId?: string }): Base => ({
    instanceId: o.instanceId,
    activatedAt: 0,
    title: sanitizeLabel(o.title),
    appName: sanitizeLabel(o.appName ?? 'Unknown app', 60) || 'Unknown app',
  });

  return {
    active,
    openFile(o) {
      return new Promise((res, rej) => {
        const req: OpenRequest = {
          ...base(o),
          kind: 'open',
          filters: o.filters ?? [],
          multiple: o.multiple ?? false,
          resolve: once(res, () => req),
        };
        enqueue(req, rej);
      });
    },
    saveFile(o) {
      return new Promise((res, rej) => {
        const req: SaveRequest = {
          ...base(o),
          kind: 'save',
          filters: o.filters ?? [],
          suggestedName: o.suggestedName ?? '',
          resolve: once(res, () => req),
        };
        enqueue(req, rej);
      });
    },
    message(o) {
      const buttons = o.buttons?.length ? o.buttons : ['OK'];
      return new Promise((res, rej) => {
        const req: MessageRequest = {
          ...base(o),
          kind: 'message',
          text: sanitizeText(o.text),
          icon: o.icon ?? 'info',
          buttons,
          defaultButton:
            o.defaultButton !== undefined && buttons.includes(o.defaultButton)
              ? o.defaultButton
              : (buttons[0] as string),
          resolve: once(res, () => req),
        };
        enqueue(req, rej);
      });
    },
    cancelFor(instanceId) {
      for (let i = queue.length - 1; i >= 0; i--) {
        const r = queue[i] as DialogRequest;
        if (r.instanceId === instanceId) {
          queue.splice(i, 1);
          cancelDialog(r);
        }
      }
      const a = active.peek();
      if (a?.instanceId === instanceId) cancelDialog(a);
    },
  };
}
