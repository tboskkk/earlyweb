import { expect, test } from 'vitest';
import { parseManifest } from '../src/index.ts';

const valid = {
  manifestVersion: 1,
  id: 'org.earlyweb.notepad',
  name: 'Notepad',
  version: '0.1.0',
  description: 'x',
  author: { name: 'EarlyWeb' },
  license: 'MIT',
  sdk: '^0.1.0',
  entry: 'index.html',
  icons: { '16': 'icons/16.svg' },
  permissions: ['fs.dialog'],
};

test('fills defaults', () => {
  const m = parseManifest(valid);
  expect(m.window).toEqual({
    width: 640,
    height: 480,
    minWidth: 200,
    minHeight: 120,
    resizable: true,
    singleInstance: false,
  });
  expect(m.network).toEqual([]);
  expect(m.fileHandlers).toEqual([]);
  expect(m.category).toBe('accessories');
});

test('ignores unknown top-level keys and accepts handlers', () => {
  const m = parseManifest({
    ...valid,
    $schema: 'x',
    author: { name: 'A', url: 'https://a.example' },
    fileHandlers: [{ extensions: ['txt'], mime: ['text/plain'] }],
  });
  expect('$schema' in m).toBe(false);
  expect(m.fileHandlers).toHaveLength(1);
});

test.each([
  ['bad id', { id: 'Notepad' }, 'id'],
  ['two-part id', { id: 'earlyweb.notepad' }, 'id'],
  ['bad semver', { version: '1.0' }, 'version'],
  ['unknown permission', { permissions: ['fs.everything'] }, 'permissions.0'],
  ['entry escapes', { entry: '../x.html' }, 'entry'],
  ['absolute entry', { entry: '/index.html' }, 'entry'],
  ['bad host', { network: ['http://evil.com'] }, 'network.0'],
  ['wrong manifestVersion', { manifestVersion: 2 }, 'manifestVersion'],
])('rejects %s with EINVAL at path %s', (_, patch, path) => {
  expect(() => parseManifest({ ...valid, ...patch })).toThrow(
    expect.objectContaining({ code: 'EINVAL', message: expect.stringMatching(new RegExp(`^${path}: .+`)) }),
  );
});

test('error message format is "<dotted path>: <message>"', () => {
  expect(() => parseManifest({ ...valid, id: 'Notepad' })).toThrow(/^id: invalid app id$/);
  expect(() => parseManifest({ ...valid, network: ['http://evil.com'] })).toThrow(
    /^network\.0: invalid network host$/,
  );
});
