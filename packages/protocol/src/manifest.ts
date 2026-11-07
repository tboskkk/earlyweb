import * as v from 'valibot';
import { EwError } from './errors.ts';

const folders = ['documents', 'music', 'pictures', 'downloads', 'desktop'] as const;

export const PERMISSIONS = [
  'fs.dialog',
  ...folders.flatMap((f) => [`fs.${f}:read`, `fs.${f}:write`] as const),
  'fs.mounts:read',
  'fs.home:read',
  'fs.home:write',
  'notifications',
  'clipboard.read',
  'clipboard.write',
  'net.fetch',
  'media.capture',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const relPath = v.pipe(
  v.string(),
  v.minLength(1),
  v.check((s) => !s.startsWith('/') && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s), 'must be a relative path'),
  v.check((s) => !s.split(/[\\/]/).includes('..'), 'must not contain ".." segments'),
);

const host = v.pipe(v.string(), v.regex(/^(\*\.)?[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'invalid network host'));

export const ManifestSchema = v.object({
  manifestVersion: v.literal(1),
  id: v.pipe(v.string(), v.regex(/^[a-z0-9]+(\.[a-z0-9-]+){2,}$/, 'invalid app id')),
  name: v.pipe(v.string(), v.minLength(1)),
  version: v.pipe(v.string(), v.regex(/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/, 'invalid semver')),
  description: v.string(),
  author: v.object({ name: v.string(), url: v.optional(v.string()) }),
  license: v.string(),
  sdk: v.string(),
  entry: relPath,
  icons: v.record(v.picklist(['16', '32', '48']), relPath),
  category: v.optional(v.string(), 'accessories'),
  permissions: v.array(v.picklist(PERMISSIONS)),
  network: v.optional(v.array(host), []),
  fileHandlers: v.optional(
    v.array(v.object({ extensions: v.array(v.string()), mime: v.optional(v.array(v.string())) })),
    [],
  ),
  window: v.optional(
    v.object({
      width: v.optional(v.number(), 640),
      height: v.optional(v.number(), 480),
      minWidth: v.optional(v.number(), 200),
      minHeight: v.optional(v.number(), 120),
      resizable: v.optional(v.boolean(), true),
      singleInstance: v.optional(v.boolean(), false),
    }),
    {},
  ),
});

export type Manifest = v.InferOutput<typeof ManifestSchema>;

export function parseManifest(json: unknown): Manifest {
  const r = v.safeParse(ManifestSchema, json);
  if (r.success) return r.output;
  const issue = r.issues[0];
  const path = issue ? (v.getDotPath(issue) ?? '') : '';
  throw new EwError('EINVAL', `${path}: ${issue?.message ?? 'invalid manifest'}`);
}
