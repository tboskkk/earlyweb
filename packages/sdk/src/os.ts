import type {
  EventMap,
  FileFilter,
  FileRef,
  FsEntry,
  InitMsg,
  LaunchArgs,
  MessagePortLike,
  ThemeData,
} from '@earlyweb/protocol';
import { createRpc } from './rpc.ts';

type Ref = FileRef | string;
const id = (r: Ref) => (typeof r === 'string' ? r : r.id);

export type Os = {
  launch: LaunchArgs;
  ready(): Promise<void>;
  on<K extends keyof EventMap>(name: K, fn: (data: EventMap[K]) => void): void;
  off<K extends keyof EventMap>(name: K, fn: (data: EventMap[K]) => void): void;
  window: {
    setTitle(title: string): Promise<void>;
    setSize(width: number, height: number): Promise<void>;
    close(): Promise<void>;
    minimize(): Promise<void>;
    onBeforeClose(fn: () => boolean | Promise<boolean>): void;
  };
  fs: {
    readText(ref: Ref): Promise<string>;
    writeText(ref: Ref, text: string): Promise<void>;
    read(ref: Ref): Promise<Blob>;
    write(ref: Ref, data: Blob): Promise<void>;
    list(ref: Ref): Promise<FsEntry[]>;
    stat(ref: Ref): Promise<FsEntry | null>;
    mkdir(ref: Ref): Promise<void>;
    remove(ref: Ref): Promise<void>;
    rename(from: Ref, to: Ref): Promise<void>;
  };
  dialog: {
    open(opts?: { filters?: FileFilter[]; multiple?: boolean }): Promise<FileRef[] | null>;
    save(opts?: { suggestedName?: string; filters?: FileFilter[] }): Promise<FileRef | null>;
    message(opts: {
      title: string;
      text: string;
      icon?: 'info' | 'warning' | 'error' | 'question';
      buttons?: string[];
    }): Promise<string>;
  };
  theme: { get(): Promise<ThemeData> };
};

function applyTheme(theme: ThemeData): void {
  if (typeof document === 'undefined') return;
  for (const [name, value] of Object.entries(theme.tokens)) {
    document.documentElement.style.setProperty(name, value);
  }
}

export function createOs(init: InitMsg, port: MessagePortLike): Os {
  const rpc = createRpc(port);
  const done = <T>(p: Promise<T>) => p.then(() => undefined);

  applyTheme(init.theme);
  rpc.on('theme.changed', applyTheme);

  if (typeof document !== 'undefined') {
    // Clicks inside an iframe never reach the shell; ask it to focus this window.
    document.addEventListener(
      'pointerdown',
      () => {
        rpc.call('window.focus').catch(() => {});
      },
      true,
    );
  }

  return {
    launch: init.launch,
    ready: () => done(rpc.call('app.ready')),
    on: (name, fn) => rpc.on(name, fn),
    off: (name, fn) => rpc.off(name, fn),
    window: {
      setTitle: (title) => done(rpc.call('window.setTitle', { title })),
      setSize: (width, height) => done(rpc.call('window.setSize', { width, height })),
      close: () => done(rpc.call('window.close')),
      minimize: () => done(rpc.call('window.minimize')),
      onBeforeClose: (fn) => rpc.handle('beforeClose', fn),
    },
    fs: {
      readText: (r) => rpc.call('fs.readText', { ref: id(r) }),
      writeText: (r, text) => done(rpc.call('fs.writeText', { ref: id(r), text })),
      read: (r) => rpc.call('fs.read', { ref: id(r) }),
      write: (r, data) => done(rpc.call('fs.write', { ref: id(r), data })),
      list: (r) => rpc.call('fs.list', { ref: id(r) }),
      stat: (r) => rpc.call('fs.stat', { ref: id(r) }),
      mkdir: (r) => done(rpc.call('fs.mkdir', { ref: id(r) })),
      remove: (r) => done(rpc.call('fs.remove', { ref: id(r) })),
      rename: (from, to) => done(rpc.call('fs.rename', { from: id(from), to: id(to) })),
    },
    dialog: {
      open: (opts = {}) => rpc.call('dialog.open', opts),
      save: (opts = {}) => rpc.call('dialog.save', opts),
      message: (opts) => rpc.call('dialog.message', opts),
    },
    theme: { get: () => rpc.call('theme.get') },
  };
}
