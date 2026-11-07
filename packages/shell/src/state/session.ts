import type { Kv } from '@earlyweb/backends';
import { type LaunchArgs, LaunchArgsSchema } from '@earlyweb/protocol';
import type { Signal } from '@preact/signals';
import * as v from 'valibot';
import type { InstanceEntry, Launcher } from '../host/launcher.ts';
import type { CatalogEntry } from './catalog.ts';
import type { Rect, WindowState, WindowStore } from './windows.ts';

const KEY = 'session';
/** Defensive cap on windows restored from a (possibly tampered) stored session. */
export const MAX_RESTORE = 20;

export type SessionRecord = { appId: string; rect: Rect; state: WindowState['state']; launch: LaunchArgs };

const RecordSchema = v.object({
  appId: v.string(),
  rect: v.object({ x: v.number(), y: v.number(), w: v.number(), h: v.number() }),
  state: v.picklist(['normal', 'minimized', 'maximized']),
  launch: LaunchArgsSchema,
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
  return raw.flatMap((r) => {
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
  const known = new Set(catalog.value.map((c) => c.manifest.id));
  let n = 0;
  for (const r of records) {
    if (n >= MAX_RESTORE) break;
    if (!known.has(r.appId)) continue;
    n++;
    const instanceId = launcher.launch(r.appId, r.launch, r.rect);
    if (!store || r.state === 'normal') continue;
    const windowId = launcher.instances.peek().get(instanceId)?.instance.windowId;
    if (!windowId) continue;
    if (r.state === 'maximized') store.toggleMaximize(windowId);
    else store.minimize(windowId);
  }
}
