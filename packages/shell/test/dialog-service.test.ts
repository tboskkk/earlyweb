import { expect, test } from 'vitest';
import { createDialogService } from '../src/dialogs/dialog-service.ts';

test('dialogs queue FIFO, one active at a time', async () => {
  const d = createDialogService();
  const a = d.message({ title: 'A', text: 'a' });
  const b = d.openFile({ title: 'B' });
  expect(d.active.value?.kind).toBe('message');
  const first = d.active.value;
  if (first?.kind !== 'message') throw new Error('x');
  first.resolve('OK');
  expect(await a).toBe('OK');
  expect(d.active.value?.kind).toBe('open');
  const second = d.active.value;
  if (second?.kind !== 'open') throw new Error('x');
  second.resolve(['/x']);
  expect(await b).toEqual(['/x']);
  expect(d.active.value).toBeNull();
});

test('resolves exactly once', async () => {
  const d = createDialogService();
  const p = d.saveFile({ title: 't' });
  const req = d.active.value;
  if (req?.kind !== 'save') throw new Error('x');
  req.resolve('/a');
  req.resolve('/b');
  expect(await p).toBe('/a');
});

test('message defaults buttons to OK; title and appName are sanitized and truncated', () => {
  const d = createDialogService();
  void d.message({ title: `‮evil\u0007${'x'.repeat(300)}`, text: 't', appName: 'A‮p' });
  const req = d.active.value;
  if (req?.kind !== 'message') throw new Error('x');
  expect(req.buttons).toEqual(['OK']);
  expect(req.title).toBe(`${`evil${'x'.repeat(75)}`.slice(0, 79)}\u2026`);
  expect(req.title.length).toBeLessThanOrEqual(80);
  expect(req.appName).toBe('Ap');
});
