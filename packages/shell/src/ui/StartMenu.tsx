import { useEffect } from 'preact/hooks';
import type { CatalogEntry } from '../state/catalog.ts';

type Props = { apps: CatalogEntry[]; onLaunch(appId: string): void; onClose(): void };

export function StartMenu({ apps, onLaunch, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Element | null;
      if (!t?.closest('.ew-startmenu, .ew-start')) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [onClose]);

  const groups = new Map<string, CatalogEntry[]>();
  for (const a of apps) {
    const cat = a.manifest.category;
    groups.set(cat, [...(groups.get(cat) ?? []), a]);
  }

  return (
    <div class="ew-startmenu" role="menu">
      {apps.length === 0 && <div class="ew-startmenu-empty">No apps installed</div>}
      {[...groups].map(([cat, entries]) => (
        <div key={cat}>
          <h4>{cat}</h4>
          {entries.map((a) => (
            <button
              type="button"
              key={a.manifest.id}
              class="ew-startmenu-item"
              role="menuitem"
              onClick={() => {
                onLaunch(a.manifest.id);
                onClose();
              }}
            >
              {a.manifest.name}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
