import type { FsBackend } from '@earlyweb/backends';
import { basename, dirname, normalizePath } from '@earlyweb/backends';
import { EwError, type FileRef, type MethodMap } from '@earlyweb/protocol';
import { type DialogService, sanitizeLabel } from '../../dialogs/dialog-service.ts';
import { validateSaveName } from '../../dialogs/save-validation.ts';
import type { GrantTable } from '../../services/grants.ts';
import type { CallContext, Handler } from '../broker.ts';

export { DEFAULT_DIR } from '../../dialogs/dialog-service.ts';

type Deps = {
  dialogs: DialogService;
  grants: GrantTable;
  fs: FsBackend;
  /** Called after each successful grant so the shell can record the most recent file for the instance. */
  onGrant?(instanceId: string, ref: FileRef): void;
};

const appName = (ctx: CallContext) => ctx.instance.manifest.name || ctx.instance.appId;

// Paths come from the trusted dialog, but a buggy UI must never mint a grant for a weird path.
function strictPath(p: string): string {
  let n: string;
  try {
    n = normalizePath(p);
  } catch {
    throw new EwError('EINVAL', 'Invalid argument');
  }
  if (n !== p || n === '/') throw new EwError('EINVAL', 'Invalid argument');
  return n;
}

export function dialogHandlers(deps: Deps): Partial<Record<keyof MethodMap, Handler>> {
  const { dialogs, grants, fs, onGrant } = deps;
  const grant = (ctx: CallContext, path: string): FileRef => {
    const ref = grants.issue(ctx.instance.appId, path);
    onGrant?.(ctx.instance.instanceId, ref);
    return ref;
  };

  return {
    'dialog.open': async (
      ctx,
      p: { filters?: { name: string; extensions: string[] }[]; multiple?: boolean },
    ) => {
      const picked = await dialogs.openFile({
        filters: p.filters,
        multiple: p.multiple,
        title: 'Open',
        appName: appName(ctx),
      });
      if (!picked) return null;
      const paths = picked.map(strictPath);
      return paths.map((path) => grant(ctx, path));
    },

    'dialog.save': async (
      ctx,
      p: { suggestedName?: string; filters?: { name: string; extensions: string[] }[] },
    ) => {
      const chosen = await dialogs.saveFile({
        suggestedName: p.suggestedName,
        filters: p.filters,
        title: 'Save As',
        appName: appName(ctx),
      });
      if (!chosen) return null;
      const path = strictPath(chosen);
      const name = basename(path);
      const v = validateSaveName(name, p.filters);
      if (!v.ok || v.name !== name) throw new EwError('EINVAL', 'Invalid argument');

      const dir = await fs.stat(dirname(path));
      if (!dir) throw new EwError('ENOENT', 'No such file or directory');
      if (dir.kind !== 'dir') throw new EwError('EINVAL', 'Invalid argument');
      const existing = await fs.stat(path);
      if (existing?.kind === 'dir') throw new EwError('EINVAL', 'Invalid argument');
      if (existing) {
        const answer = await dialogs.message({
          title: 'Confirm Save As',
          text: `${name} already exists.\nDo you want to replace it?`,
          icon: 'warning',
          buttons: ['Yes', 'No'],
          appName: appName(ctx),
        });
        if (answer !== 'Yes') return null;
      }
      return grant(ctx, path);
    },

    'dialog.message': async (
      ctx,
      p: {
        title: string;
        text: string;
        icon?: 'info' | 'warning' | 'error' | 'question';
        buttons?: string[];
      },
    ) => {
      const original = p.buttons?.length ? p.buttons : ['OK'];
      const labels = original.map((b) => sanitizeLabel(b, 40) || 'OK');
      const clicked = await dialogs.message({
        title: sanitizeLabel(p.title),
        text: p.text,
        icon: p.icon,
        buttons: labels,
        appName: appName(ctx),
      });
      const i = labels.indexOf(clicked);
      if (i < 0) throw new EwError('EINVAL', 'Invalid argument');
      return original[i];
    },
  };
}
