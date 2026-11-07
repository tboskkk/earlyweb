import { EwError } from '@earlyweb/protocol';
import { expect, test } from 'vitest';
import { createDialogService, MAX_PENDING_PER_INSTANCE } from '../src/dialogs/dialog-service.ts';

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
  void d.message({ title: `\u202Eevil\u0007${'x'.repeat(300)}`, text: 't', appName: 'A\u202Ep' });
  const req = d.active.value;
  if (req?.kind !== 'message') throw new Error('x');
  expect(req.buttons).toEqual(['OK']);
  expect(req.title).toBe(`${`evil${'x'.repeat(75)}`.slice(0, 79)}\u2026`);
  expect(req.title.length).toBeLessThanOrEqual(80);
  expect(req.appName).toBe('Ap');
});

test('per-instance cap: queued + active dialogs; further requests reject with ERATE', async () => {
  const d = createDialogService();
  for (let i = 0; i < MAX_PENDING_PER_INSTANCE; i++)
    void d.message({ title: 't', text: 'x', instanceId: 'a' });
  const over = d.message({ title: 't', text: 'x', instanceId: 'a' });
  await expect(over).rejects.toMatchObject({ code: 'ERATE' });
  await expect(over).rejects.toBeInstanceOf(EwError);
  // another instance is unaffected
  void d.message({ title: 't', text: 'x', instanceId: 'b' });
  // resolving one frees a slot
  const a = d.active.value;
  if (a?.kind !== 'message') throw new Error('x');
  a.resolve('OK');
  const again = d.message({ title: 't', text: 'x', instanceId: 'a' });
  void again;
  expect(d.active.value).not.toBeNull();
});

test('cancelFor resolves queued dialogs as cancelled and dismisses the active one', async () => {
  const d = createDialogService();
  const m = d.message({ title: 't', text: 'x', buttons: ['OK', 'Cancel'], instanceId: 'a' }); // active
  const o = d.openFile({ title: 't', instanceId: 'a' });
  const s = d.saveFile({ title: 't', instanceId: 'a' });
  const other = d.message({ title: 't', text: 'keep', buttons: ['A', 'B'], instanceId: 'b' });
  d.cancelFor('a');
  expect(await m).toBe('Cancel');
  expect(await o).toBeNull();
  expect(await s).toBeNull();
  const act = d.active.value;
  expect(act?.kind === 'message' && act.text).toBe('keep');
  d.cancelFor('b');
  expect(await other).toBe('B'); // no Cancel button -> last button
  expect(d.active.value).toBeNull();
});

test('message defaultButton falls back to the first button', () => {
  const d = createDialogService();
  void d.message({ title: 't', text: 'x', buttons: ['Yes', 'No'], defaultButton: 'No' });
  const r = d.active.value;
  expect(r?.kind === 'message' && r.defaultButton).toBe('No');
  const d2 = createDialogService();
  void d2.message({ title: 't', text: 'x', buttons: ['Yes', 'No'], defaultButton: 'Nope' });
  const r2 = d2.active.value;
  expect(r2?.kind === 'message' && r2.defaultButton).toBe('Yes');
});
