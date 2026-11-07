export const ERROR_CODES = [
  'EPERM',
  'ENOENT',
  'EEXIST',
  'EINVAL',
  'EQUOTA',
  'ECANCELED',
  'ERATE',
  'EUNSUPPORTED',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export class EwError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = 'EwError';
    this.code = code;
  }
}
