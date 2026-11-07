import { expect, test } from 'vitest';
import { validateSaveName } from '../src/dialogs/save-validation.ts';

const txt = [{ name: 'Text', extensions: ['.txt'] }];

test.each(['', '   ', 'a/b', 'a\\b', '.', '..', 'a'.repeat(256), 'a\u0000b', ' .. '])(
  'rejects %j',
  (name) => {
    const r = validateSaveName(name, txt);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
  },
);

test('appends the first filter extension when the name has none', () => {
  expect(validateSaveName('notes', txt)).toEqual({ ok: true, name: 'notes.txt' });
  expect(validateSaveName('notes', [{ name: 'T', extensions: ['md', '.txt'] }])).toEqual({
    ok: true,
    name: 'notes.md',
  });
});

test('keeps an existing extension even if the filter differs', () => {
  expect(validateSaveName('notes.md', txt)).toEqual({ ok: true, name: 'notes.md' });
});

test('trims surrounding whitespace', () => {
  expect(validateSaveName('  notes  ', txt)).toEqual({ ok: true, name: 'notes.txt' });
  expect(validateSaveName('  a.md ')).toEqual({ ok: true, name: 'a.md' });
});

test('no filters or wildcard filter: no extension appended', () => {
  expect(validateSaveName('notes')).toEqual({ ok: true, name: 'notes' });
  expect(validateSaveName('notes', [{ name: 'All', extensions: ['*'] }])).toEqual({
    ok: true,
    name: 'notes',
  });
});

test('255 chars is fine, and the appended extension counts toward the limit', () => {
  expect(validateSaveName('a'.repeat(255)).ok).toBe(true);
  expect(validateSaveName('a'.repeat(253), txt).ok).toBe(false);
});

test('hostile or unsafe filter extensions are ignored', () => {
  for (const ext of ['/../../../x.txt', '.t/xt', 'a b', 'x'.repeat(17), '.', '..', '\\x', '.t\u0000']) {
    expect(validateSaveName('notes', [{ name: 'h', extensions: [ext] }])).toEqual({
      ok: true,
      name: 'notes',
    });
  }
  expect(validateSaveName('notes', [{ name: 'h', extensions: ['/../x', '.md'] }])).toEqual({
    ok: true,
    name: 'notes.md',
  });
});
