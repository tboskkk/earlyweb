import { expect, test } from 'vitest';
import { basename, dirname, isWithin, joinPath, normalizePath } from '../src/index.ts';

test('normalizePath collapses and resolves', () => {
  expect(normalizePath('/a//b/./c/../d')).toBe('/a/b/d');
  expect(normalizePath('/')).toBe('/');
  expect(normalizePath('/a/')).toBe('/a');
});

test('normalizePath rejects bad input', () => {
  expect(() => normalizePath('/../x')).toThrowError(expect.objectContaining({ code: 'EINVAL' }));
  expect(() => normalizePath('rel')).toThrowError(expect.objectContaining({ code: 'EINVAL' }));
});

test('dirname, basename, joinPath', () => {
  expect(dirname('/a/b')).toBe('/a');
  expect(dirname('/a')).toBe('/');
  expect(basename('/a/b')).toBe('b');
  expect(joinPath('/a', 'b', '../c')).toBe('/a/c');
});

test('isWithin', () => {
  expect(isWithin('/apps/x/y', '/apps/x')).toBe(true);
  expect(isWithin('/apps/x', '/apps/x')).toBe(true);
  expect(isWithin('/apps/xy', '/apps/x')).toBe(false);
  expect(isWithin('/a', '/')).toBe(true);
});
