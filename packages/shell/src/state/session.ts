import type { Kv } from '@earlyweb/backends';
import type { LaunchArgs } from '@earlyweb/protocol';
import type { Signal } from '@preact/signals';
import * as v from 'valibot';
import type { InstanceEntry, Launcher } from '../host/launcher.ts';
import type { CatalogEntry } from './catalog.ts';
import type { Rect, WindowState, WindowStore } from './windows.ts';

const KEY = 'session';
/** Defensive cap on windows restored from a (possibly tampered) stored session. */
export const MAX_RESTORE = 20;
/** Only this many stored records are even looked at. */
const MAX_STORED = 100;
const MAX_SIZE = 10000;
const MAX_POS = 100000;

const finite = (lo: number, hi: number) => v.pipe(v.number(), v.finite(), v.minValue(lo), v.maxValue(hi));
const Launch = v.object({
  file: v.optional(v.object({ id: v.string(), name: v.pipe(v.string(), v.maxLength(255)) })),
  args: v.pipe(v.array(v.pipe(v.string(), v.maxLength(1024))), v.maxLength(16)),
});

export type SessionRecord = { appId: string; rect: Rect; state: WindowState['state']; launch: LaunchArgs };

const RecordSchema = v.object({
  appId: v.string(),
  rect: v.object({
    x: finite(-MAX_POS, MAX_POS),
    y: finite(-MAX_POS, MAX_POS),
    w: finite(1, MAX_SIZE),
    h: finite(1, MAX_SIZE),
  }),
  state: v.picklist(['normal', 'minimized', 'maximized']),
  launch: Launch,
});

/**
 * One record per open instance, ordered by window z (lowest first). Maximized
 * windows record their restoreRect so the normal size is not lost.
 */
export function snapshot(store: WindowStore, instances: Signal<Map<string, InstanceEntry>>): SessionRecord[] {
  const byWindow = new Map<string, InstanceEntry>();
  for (const e of instances.peek().values()) byWindow.set(e.instance.windowId, e);
  const out: SessionRecord[] = [];
  for (const w of [...store.windows.peek()].sort((a, b) => a.z - b.z)) {
    const e = byWindow.get(w.id);
    if (!e) continue;
    const r = w.restoreRect ?? w;
    out.push({
      appId: w.appId,
      rect: { x: r.x, y: r.y, w: r.w, h: r.h },
      // A window minimized from maximized records 'minimized' (and its restoreRect).
      state: w.state,
      launch: e.instance.launch,
    });
  }
  return out;
}

export async function saveSession(kv: Kv, records: SessionRecord[]): Promise<void> {
  await kv.set(KEY, records);
}

/** [] when missing or not an array; individually malformed records are dropped. */
export async function loadSession(kv: Kv): Promise<SessionRecord[]> {
  const raw = await kv.get<unknown>(KEY);
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_STORED).flatMap((r) => {
    const p = v.safeParse(RecordSchema, r);
    return p.success ? [p.output as SessionRecord] : [];
  });
}

/**
 * Restores in stored (z, lowest first) order, so the last restored window ends up
 * on top. Unknown apps are skipped. `store` is needed to apply minimized/maximized
 * state (the launcher does not expose it); a record with `restoreRect` semantics is
 * recreated by opening at the normal rect and then maximizing.
 * A stored launch.file is only a reference: the grant table enforces ownership.
 */
export function restoreSession(
  records: SessionRecord[],
  launcher: Launcher,
  catalog: Signal<CatalogEntry[]>,
  store?: WindowStore,
): void {
  const known = new Map(catalog.value.map((c) => [c.manifest.id, c.manifest.window] as const));
  let n = 0;
  for (const r of records) {
    if (n >= MAX_RESTORE) break;
    const win = known.get(r.appId);
    if (!known.has(r.appId)) continue;
    n++;
    const instanceId = launcher.launch(r.appId, r.launch, {
      ...r.rect,
      // store.open clamps position only; bound the size here (tampered values).
      w: Math.min(Math.max(r.rect.w, win?.minWidth ?? 1), MAX_SIZE),
      h: Math.min(Math.max(r.rect.h, win?.minHeight ?? 1), MAX_SIZE),
    });
    if (!store || r.state === 'normal') continue;
    const windowId = launcher.instances.peek().get(instanceId)?.instance.windowId;
    if (!windowId) continue;
    if (r.state === 'maximized') store.toggleMaximize(windowId);
    else store.minimize(windowId);
  }
}
