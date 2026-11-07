import * as v from 'valibot';
import type { Permission } from './manifest.ts';
import { FileFilterSchema, type FileRef, type FsEntry, type ThemeData } from './messages.ts';

const none = v.optional(v.object({}));
const ref = v.pipe(v.string(), v.minLength(1), v.maxLength(1024));
const refParams = v.object({ ref });
const filters = v.optional(v.array(FileFilterSchema));

type MethodDef = { params: v.GenericSchema; permission?: Permission };

export const METHODS = {
  'app.ready': { params: none },
  'window.setTitle': { params: v.object({ title: v.pipe(v.string(), v.maxLength(200)) }) },
  'window.setSize': {
    params: v.object({ width: v.pipe(v.number(), v.integer()), height: v.pipe(v.number(), v.integer()) }),
  },
  'window.close': { params: none },
  'window.minimize': { params: none },
  'window.focus': { params: none },
  'fs.readText': { params: refParams },
  'fs.writeText': { params: v.object({ ref, text: v.string() }) },
  'fs.read': { params: refParams },
  'fs.write': { params: v.object({ ref, data: v.instance(Blob) }) },
  'fs.list': { params: refParams },
  'fs.stat': { params: refParams },
  'fs.mkdir': { params: refParams },
  'fs.remove': { params: refParams },
  'fs.rename': { params: v.object({ from: ref, to: ref }) },
  'dialog.open': {
    params: v.object({ filters, multiple: v.optional(v.boolean()) }),
    permission: 'fs.dialog',
  },
  'dialog.save': {
    params: v.object({ suggestedName: v.optional(v.string()), filters }),
    permission: 'fs.dialog',
  },
  'dialog.message': {
    params: v.object({
      title: v.string(),
      text: v.string(),
      icon: v.optional(v.picklist(['info', 'warning', 'error', 'question'])),
      buttons: v.optional(v.pipe(v.array(v.string()), v.minLength(1), v.maxLength(3))),
    }),
  },
  'theme.get': { params: none },
} as const satisfies Record<string, MethodDef>;

export type MethodName = keyof typeof METHODS;

type Results = {
  'app.ready': null;
  'window.setTitle': null;
  'window.setSize': null;
  'window.close': null;
  'window.minimize': null;
  'window.focus': null;
  'fs.readText': string;
  'fs.writeText': null;
  'fs.read': Blob;
  'fs.write': null;
  'fs.list': FsEntry[];
  'fs.stat': FsEntry | null;
  'fs.mkdir': null;
  'fs.remove': null;
  'fs.rename': null;
  'dialog.open': FileRef[] | null;
  'dialog.save': FileRef | null;
  'dialog.message': string;
  'theme.get': ThemeData;
};

export type MethodMap = {
  [K in MethodName]: { params: v.InferOutput<(typeof METHODS)[K]['params']>; result: Results[K] };
};
