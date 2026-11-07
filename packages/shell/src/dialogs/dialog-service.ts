import type { FileFilter } from '@earlyweb/protocol';
import { type Signal, signal } from '@preact/signals';

export const DEFAULT_DIR = '/home/user/Documents';

export type DialogIcon = 'info' | 'warning' | 'error' | 'question';

type Base = { appName: string; title: string };
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
  }): Promise<string[] | null>;
  saveFile(opts: {
    suggestedName?: string;
    filters?: FileFilter[];
    title: string;
    appName?: string;
  }): Promise<string | null>;
  message(opts: {
    title: string;
    text: string;
    icon?: DialogIcon;
    buttons?: string[];
    appName?: string;
  }): Promise<string>;
};

// Control and bidi override/isolate characters could spoof the dialog chrome.
const UNSAFE = /[\p{Cc}‪-‮⁦-⁩]/gu;
export function sanitizeLabel(s: string, max = 80): string {
  const clean = s.replace(UNSAFE, '').trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

/**
 * Queue of trusted dialogs: FIFO, one active at a time.
 * Not implemented (documented limitation): dropping a closed app's queued
 * dialogs. A dialog from an app that has since exited stays until dismissed.
 */
export function createDialogService(): DialogService {
  const active = signal<DialogRequest | null>(null);
  const queue: DialogRequest[] = [];

  const advance = () => {
    active.value = queue.shift() ?? null;
  };
  const enqueue = (req: DialogRequest) => {
    if (active.peek()) queue.push(req);
    else active.value = req;
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
  const base = (o: { title: string; appName?: string }): Base => ({
    title: sanitizeLabel(o.title),
    appName: sanitizeLabel(o.appName ?? 'Unknown app', 60) || 'Unknown app',
  });

  return {
    active,
    openFile(o) {
      return new Promise((res) => {
        const req: OpenRequest = {
          ...base(o),
          kind: 'open',
          filters: o.filters ?? [],
          multiple: o.multiple ?? false,
          resolve: once(res, () => req),
        };
        enqueue(req);
      });
    },
    saveFile(o) {
      return new Promise((res) => {
        const req: SaveRequest = {
          ...base(o),
          kind: 'save',
          filters: o.filters ?? [],
          suggestedName: o.suggestedName ?? '',
          resolve: once(res, () => req),
        };
        enqueue(req);
      });
    },
    message(o) {
      return new Promise((res) => {
        const req: MessageRequest = {
          ...base(o),
          kind: 'message',
          text: o.text,
          icon: o.icon ?? 'info',
          buttons: o.buttons?.length ? o.buttons : ['OK'],
          resolve: once(res, () => req),
        };
        enqueue(req);
      });
    },
  };
}
