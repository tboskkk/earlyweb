import * as v from 'valibot';
import { ERROR_CODES, type ErrorCode } from './errors.ts';

export const PROTOCOL_VERSION = 1;

export const FileRefSchema = v.object({ id: v.string(), name: v.string() });
export type FileRef = v.InferOutput<typeof FileRefSchema>;

export const LaunchArgsSchema = v.object({
  file: v.optional(FileRefSchema),
  args: v.array(v.string()),
});
export type LaunchArgs = v.InferOutput<typeof LaunchArgsSchema>;

export const ThemeDataSchema = v.object({ tokens: v.record(v.string(), v.string()) });
export type ThemeData = v.InferOutput<typeof ThemeDataSchema>;

export const FsEntrySchema = v.object({
  name: v.string(),
  kind: v.picklist(['file', 'dir']),
  size: v.number(),
  mtime: v.number(),
});
export type FsEntry = v.InferOutput<typeof FsEntrySchema>;

export const FileFilterSchema = v.object({ name: v.string(), extensions: v.array(v.string()) });
export type FileFilter = v.InferOutput<typeof FileFilterSchema>;

export const HelloMsgSchema = v.object({ ew: v.literal('hello'), protocol: v.number() });
export type HelloMsg = v.InferOutput<typeof HelloMsgSchema>;

export const InitMsgSchema = v.object({
  ew: v.literal('init'),
  protocol: v.literal(PROTOCOL_VERSION),
  instanceId: v.string(),
  appId: v.string(),
  launch: LaunchArgsSchema,
  theme: ThemeDataSchema,
  permissions: v.array(v.string()),
});
export type InitMsg = v.InferOutput<typeof InitMsgSchema>;

export const isHello = (x: unknown): x is HelloMsg => v.is(HelloMsgSchema, x);
export const isInit = (x: unknown): x is InitMsg => v.is(InitMsgSchema, x);

export type EventMap = {
  focus: null;
  blur: null;
  resize: { width: number; height: number };
  'theme.changed': ThemeData;
  'file.open': { file: FileRef };
};

export type RequestMap = {
  ping: true;
  beforeClose: boolean;
};

export const CallMsgSchema = v.object({
  t: v.literal('call'),
  id: v.number(),
  method: v.string(),
  params: v.optional(v.unknown()),
});
export type CallMsg = v.InferOutput<typeof CallMsgSchema>;

export const ResponseMsgSchema = v.object({
  t: v.literal('response'),
  id: v.number(),
  value: v.unknown(),
});
export type ResponseMsg = v.InferOutput<typeof ResponseMsgSchema>;

export const AppToShellSchema = v.variant('t', [CallMsgSchema, ResponseMsgSchema]);
export type AppToShellMsg = v.InferOutput<typeof AppToShellSchema>;

export type ResultMsg =
  | { t: 'result'; id: number; ok: true; value: unknown }
  | { t: 'result'; id: number; ok: false; error: { code: ErrorCode; message: string } };

export type EventMsg = { t: 'event'; name: keyof EventMap; data: unknown };
export type RequestMsg = { t: 'request'; id: number; name: keyof RequestMap; data?: unknown };
export type ShellToAppMsg = ResultMsg | EventMsg | RequestMsg;

export const ResultMsgSchema = v.variant('ok', [
  v.object({ t: v.literal('result'), id: v.number(), ok: v.literal(true), value: v.unknown() }),
  v.object({
    t: v.literal('result'),
    id: v.number(),
    ok: v.literal(false),
    error: v.object({ code: v.picklist(ERROR_CODES), message: v.string() }),
  }),
]);

export type MessagePortLike = {
  postMessage(msg: unknown, transfer?: Transferable[]): void;
  addEventListener(type: 'message', fn: (e: { data: unknown }) => void): void;
  start(): void;
  close(): void;
};
