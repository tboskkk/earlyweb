import { useState } from 'preact/hooks';
import type { CatalogEntry } from '../state/catalog.ts';
import type { WindowStore } from '../state/windows.ts';
import { Clock } from './Clock.tsx';
import { StartMenu } from './StartMenu.tsx';

type Props = { store: WindowStore; apps: CatalogEntry[]; onLaunch(appId: string): void };

export function Taskbar({ store, apps, onLaunch }: Props) {
  const [open, setOpen] = useState(false);
  const focusedId = store.focusedId.value;

  return (
    <div class="ew-taskbar">
      {open && <StartMenu apps={apps} onLaunch={onLaunch} onClose={() => setOpen(false)} />}
      <button type="button" class="ew-start" onClick={() => setOpen(!open)}>
        <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
          <circle cx="9" cy="9" r="8" fill="#fff" fill-opacity="0.9" />
          <path d="M9 3 L14 9 L9 15 L4 9 Z" fill="#2a8f47" />
        </svg>
        start
      </button>
      <div class="ew-tasks">
        {store.windows.value.map((w) => (
          <button
            type="button"
            key={w.id}
            class={`ew-task${focusedId === w.id && w.state !== 'minimized' ? ' ew-active' : ''}`}
            onClick={() => {
              if (focusedId === w.id && w.state !== 'minimized') store.minimize(w.id);
              else store.focus(w.id);
            }}
          >
            {w.title}
          </button>
        ))}
      </div>
      <Clock />
    </div>
  );
}
