import type { FsBackend, FsStat } from '@earlyweb/backends';
import { dirname, joinPath } from '@earlyweb/backends';
import { useEffect, useRef, useState } from 'preact/hooks';
import { DEFAULT_DIR, type OpenRequest, type SaveRequest } from './dialog-service.ts';
import { safeExts, validateSaveName } from './save-validation.ts';

const ROOT = '/home/user';

function matches(name: string, exts: string[] | undefined): boolean {
  const safe = safeExts(exts); // unsafe app-supplied extensions are ignored
  if (safe.length === 0) return true;
  const lower = name.toLowerCase();
  return safe.some((e) => lower.endsWith(e.toLowerCase()));
}

function Tree({
  fs,
  path,
  label,
  cwd,
  onNav,
  depth,
}: {
  fs: FsBackend;
  path: string;
  label: string;
  cwd: string;
  onNav(p: string): void;
  depth: number;
}) {
  const onPath = cwd === path || cwd.startsWith(`${path}/`);
  const [open, setOpen] = useState(onPath);
  const [kids, setKids] = useState<FsStat[] | null>(null);
  useEffect(() => {
    if (onPath) setOpen(true);
  }, [onPath]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    fs.list(path).then(
      (l) => live && setKids(l.filter((e) => e.kind === 'dir').sort((a, b) => a.name.localeCompare(b.name))),
      () => live && setKids([]),
    );
    return () => {
      live = false;
    };
  }, [open, path, fs]);
  return (
    <div role="treeitem" tabIndex={-1} aria-expanded={open} aria-selected={cwd === path}>
      <div
        class={`ew-tree-row${cwd === path ? ' ew-sel' : ''}`}
        style={{ paddingLeft: `${depth * 12 + 4}px` }}
      >
        <button
          type="button"
          class="ew-tree-twist"
          tabIndex={-1}
          aria-label="Expand"
          onClick={() => setOpen(!open)}
        >
          {open ? '▾' : '▸'}
        </button>
        <button type="button" class="ew-tree-name" tabIndex={-1} onClick={() => onNav(path)}>
          {label}
        </button>
      </div>
      {open &&
        kids?.map((k) => (
          <Tree key={k.path} fs={fs} path={k.path} label={k.name} cwd={cwd} onNav={onNav} depth={depth + 1} />
        ))}
    </div>
  );
}

export function FileDialog({ req, fs }: { req: OpenRequest | SaveRequest; fs: FsBackend }) {
  const isSave = req.kind === 'save';
  const [cwd, setCwd] = useState(DEFAULT_DIR);
  const [entries, setEntries] = useState<FsStat[]>([]);
  const [filterIdx, setFilterIdx] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [name, setName] = useState(isSave ? req.suggestedName : '');
  const [error, setError] = useState('');
  const nameRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Fall back to the home root when the default folder is gone.
  useEffect(() => {
    fs.stat(DEFAULT_DIR).then(
      (s) => {
        if (s?.kind !== 'dir') setCwd(ROOT);
      },
      () => setCwd(ROOT),
    );
  }, [fs]);

  useEffect(() => {
    let live = true;
    setSelected([]);
    fs.list(cwd).then(
      (l) => live && setEntries(l),
      () => live && setEntries([]),
    );
    return () => {
      live = false;
    };
  }, [cwd, fs]);

  useEffect(() => {
    (isSave ? nameRef.current : listRef.current)?.focus();
  }, [isSave]);

  const filter = req.filters[filterIdx];
  const activeFilters = filter ? [filter] : req.filters;
  const dirs = entries.filter((e) => e.kind === 'dir').sort((a, b) => a.name.localeCompare(b.name));
  const files = entries
    .filter((e) => e.kind === 'file' && matches(e.name, filter?.extensions))
    .sort((a, b) => a.name.localeCompare(b.name));

  const confirm = (override?: string[]) => {
    if (req.kind === 'save') {
      const r = validateSaveName(name, activeFilters);
      if (!r.ok) return setError(r.error);
      const target = joinPath(cwd, r.name);
      // The grant must land exactly in the folder the user is browsing.
      if (dirname(target) !== cwd) return setError('That is not a valid file name.');
      return req.resolve(target);
    }
    const sel = override ?? selected;
    if (sel.length === 0) return;
    const picked = entries.filter((e) => sel.includes(e.path));
    const pickedFiles = picked.filter((e) => e.kind === 'file').map((e) => e.path);
    if (pickedFiles.length === 0) {
      // Open/Enter on a folder navigates into it; only files are ever returned.
      const dir = picked.find((e) => e.kind === 'dir');
      if (dir) setCwd(dir.path);
      return;
    }
    req.resolve(req.multiple ? pickedFiles : pickedFiles.slice(0, 1));
  };

  const listKeys = (ev: KeyboardEvent) => {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp') return;
    ev.preventDefault();
    const all = [...dirs, ...files];
    const i = all.findIndex((e) => e.path === selected[0]);
    const next = all[Math.max(0, Math.min(all.length - 1, i + (ev.key === 'ArrowDown' ? 1 : -1)))];
    if (next) setSelected([next.path]);
  };

  const pick = (e: FsStat, ev: MouseEvent) => {
    if (e.kind === 'file' && req.kind === 'save') setName(e.name);
    setError('');
    if (req.kind === 'open' && req.multiple && (ev.ctrlKey || ev.metaKey)) {
      setSelected(selected.includes(e.path) ? selected.filter((p) => p !== e.path) : [...selected, e.path]);
    } else setSelected([e.path]);
  };

  const dbl = (e: FsStat) => {
    if (e.kind === 'dir') setCwd(e.path);
    else if (req.kind === 'save') {
      setName(e.name);
      confirm();
    } else confirm([e.path]);
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: Enter confirms the dialog
    <div
      class="ew-dlg-body ew-file"
      onKeyDown={(ev) => {
        const t = ev.target as HTMLElement;
        if (ev.key === 'Enter' && t.tagName !== 'BUTTON' && t.tagName !== 'SELECT') {
          ev.preventDefault();
          confirm();
        }
      }}
    >
      <div class="ew-file-path" title={cwd}>
        {cwd}
        {cwd !== ROOT && (
          <button type="button" class="ew-btn" onClick={() => setCwd(dirname(cwd))}>
            Up
          </button>
        )}
      </div>
      <div class="ew-file-panes">
        <div class="ew-file-tree" role="tree">
          <Tree fs={fs} path={ROOT} label="Home" cwd={cwd} onNav={setCwd} depth={0} />
        </div>
        <div
          class="ew-file-list"
          role="listbox"
          tabIndex={0}
          ref={listRef}
          onKeyDown={listKeys}
          aria-multiselectable={!isSave && req.multiple}
        >
          {dirs.map((e) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard path is Enter on the list / tree
            <div
              key={e.path}
              role="option"
              tabIndex={-1}
              aria-selected={selected.includes(e.path)}
              class={`ew-file-row${selected.includes(e.path) ? ' ew-sel' : ''}`}
              onClick={(ev) => pick(e, ev)}
              onDblClick={() => dbl(e)}
            >
              <span class="ew-file-ico ew-folder" aria-hidden="true" />
              {e.name}
            </div>
          ))}
          {files.map((e) => (
            // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard path is Enter on the list / filename box
            <div
              key={e.path}
              role="option"
              tabIndex={-1}
              aria-selected={selected.includes(e.path)}
              class={`ew-file-row${selected.includes(e.path) ? ' ew-sel' : ''}`}
              onClick={(ev) => pick(e, ev)}
              onDblClick={() => dbl(e)}
            >
              <span class="ew-file-ico ew-doc" aria-hidden="true" />
              {e.name}
            </div>
          ))}
          {dirs.length + files.length === 0 && <div class="ew-file-empty">This folder is empty.</div>}
        </div>
      </div>
      {isSave && (
        <label class="ew-file-field">
          File name:
          <input
            ref={nameRef}
            type="text"
            value={name}
            maxLength={300}
            onInput={(e) => {
              setName((e.target as HTMLInputElement).value);
              setError('');
            }}
          />
        </label>
      )}
      {error && (
        <div class="ew-file-error" role="alert">
          {error}
        </div>
      )}
      <div class="ew-dlg-buttons ew-file-bottom">
        {req.filters.length > 0 && (
          <select
            aria-label="File type"
            value={filterIdx}
            onChange={(e) => setFilterIdx(Number((e.target as HTMLSelectElement).value))}
          >
            {req.filters.map((f, i) => (
              <option key={i} value={i}>
                {f.name} ({f.extensions.join(', ')})
              </option>
            ))}
          </select>
        )}
        <button type="button" class="ew-btn" onClick={() => confirm()}>
          {isSave ? 'Save' : 'Open'}
        </button>
        <button type="button" class="ew-btn" onClick={() => req.resolve(null)}>
          Cancel
        </button>
      </div>
    </div>
  );
}
