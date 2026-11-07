// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { createIdbFs, ensureHome } from '@earlyweb/backends';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { CONFIRM_GUARD_MS, createDialogService } from '../src/dialogs/dialog-service.ts';
import { ModalLayer } from '../src/dialogs/ModalLayer.tsx';

let n = 0;
let root: HTMLElement;

beforeEach(() => {
  root = document.createElement('div');
  document.body.appendChild(root);
  vi.useFakeTimers({ toFake: ['performance'] });
});
afterEach(() => {
  render(null, root);
  root.remove();
  vi.useRealTimers();
});

async function mount() {
  const fs = await createIdbFs(`modal-${n++}`);
  await ensureHome(fs);
  const dialogs = createDialogService();
  await act(() => render(<ModalLayer dialogs={dialogs} fs={fs} />, root));
  return { dialogs, fs };
}
const flush = () => act(() => new Promise<void>((r) => setTimeout(r, 20)));
// only performance is faked, so real timers drive preact's effect scheduling
const settle = async () => {
  await flush();
  await flush();
};
const key = (el: Element, k: string, init: KeyboardEventInit = {}) =>
  act(() => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init }));
  });

test('initial focus lands on the message default button, not the container', async () => {
  const { dialogs } = await mount();
  void dialogs.message({ title: 't', text: 'x', buttons: ['Yes', 'No'], defaultButton: 'No' });
  await settle();
  expect((document.activeElement as HTMLElement).textContent).toBe('No');
});

test('initial focus lands on the Save dialog name box', async () => {
  const { dialogs } = await mount();
  void dialogs.saveFile({ title: 't' });
  await settle();
  expect(document.activeElement?.tagName).toBe('INPUT');
});

test('Escape cancels immediately (never delayed): message -> Cancel / last button, save -> null', async () => {
  const { dialogs } = await mount();
  const m = dialogs.message({ title: 't', text: 'x', buttons: ['OK', 'Cancel', 'Other'] });
  const o = dialogs.openFile({ title: 't' });
  await settle();
  await key(document.activeElement as Element, 'Escape');
  expect(await m).toBe('Cancel');
  await settle();
  await key(document.activeElement as Element, 'Escape');
  expect(await o).toBeNull();
  const m2 = dialogs.message({ title: 't', text: 'x', buttons: ['Yes', 'No'] });
  await settle();
  await key(document.activeElement as Element, 'Escape');
  expect(await m2).toBe('No');
});

test('Tab wraps within the dialog', async () => {
  const { dialogs } = await mount();
  void dialogs.message({ title: 't', text: 'x', buttons: ['A', 'B'] });
  await settle();
  const [a, b] = Array.from(root.querySelectorAll('button')) as HTMLButtonElement[];
  b?.focus();
  await key(b as Element, 'Tab');
  expect(document.activeElement).toBe(a);
  await key(a as Element, 'Tab', { shiftKey: true });
  expect(document.activeElement).toBe(b);
});

test('backdrop click neither dismisses the dialog nor propagates', async () => {
  const { dialogs } = await mount();
  void dialogs.message({ title: 't', text: 'x' });
  await settle();
  const seen = vi.fn();
  document.addEventListener('click', seen);
  const backdrop = root.querySelector('.ew-modal') as HTMLElement;
  await act(() => {
    backdrop.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  document.removeEventListener('click', seen);
  expect(seen).not.toHaveBeenCalled();
  expect(dialogs.active.value).not.toBeNull();
});

test('keystroke guard: clicks and Enter are ignored for the first 400 ms', async () => {
  const { dialogs } = await mount();
  const p = dialogs.message({ title: 't', text: 'x', buttons: ['Yes', 'No'] });
  await settle();
  const btn = root.querySelector('button') as HTMLButtonElement;
  vi.advanceTimersByTime(100);
  await act(() => btn.click());
  expect(dialogs.active.value).not.toBeNull();
  vi.advanceTimersByTime(CONFIRM_GUARD_MS + 100);
  await act(() => btn.click());
  expect(await p).toBe('Yes');
});

test('keystroke guard: Enter in the Save dialog is ignored at 100 ms and confirms at 500 ms', async () => {
  const { dialogs } = await mount();
  const p = dialogs.saveFile({ title: 't', suggestedName: 'a.txt' });
  await settle();
  const input = root.querySelector('input') as HTMLInputElement;
  vi.advanceTimersByTime(100);
  await key(input, 'Enter');
  expect(dialogs.active.value).not.toBeNull();
  vi.advanceTimersByTime(400);
  await key(input, 'Enter');
  expect(await p).toBe('/home/user/Documents/a.txt');
});

test('hostile filter extension through the real Save dialog stays in the browsed folder', async () => {
  const { dialogs } = await mount();
  const p = dialogs.saveFile({
    title: 't',
    suggestedName: 'notes',
    filters: [{ name: 'x', extensions: ['/../../../x.txt'] }],
  });
  await settle();
  vi.advanceTimersByTime(CONFIRM_GUARD_MS + 100);
  await key(root.querySelector('input') as Element, 'Enter');
  expect(await p).toBe('/home/user/Documents/notes');
});

test('Open: Enter on a selected folder navigates into it; files are what get returned', async () => {
  const { dialogs, fs } = await mount();
  await fs.write('/home/user/Pictures/p.png', new Blob(['x']));
  const p = dialogs.openFile({ title: 't' });
  await settle();
  vi.advanceTimersByTime(CONFIRM_GUARD_MS + 100);
  // go up to /home/user, select Pictures, press Enter
  await act(() => (root.querySelector('.ew-file-path button') as HTMLButtonElement).click());
  await settle();
  const rows = Array.from(root.querySelectorAll('.ew-file-row')) as HTMLElement[];
  await act(() => rows.find((r) => r.textContent === 'Pictures')?.click());
  await key(root.querySelector('.ew-file-list') as Element, 'Enter');
  await settle();
  expect(dialogs.active.value).not.toBeNull();
  expect(root.querySelector('.ew-file-path')?.textContent).toContain('/home/user/Pictures');
  const file = (Array.from(root.querySelectorAll('.ew-file-row')) as HTMLElement[]).find(
    (r) => r.textContent === 'p.png',
  );
  await act(() => file?.click());
  await key(root.querySelector('.ew-file-list') as Element, 'Enter');
  expect(await p).toEqual(['/home/user/Pictures/p.png']);
});

const input = (el: HTMLInputElement, value: string) =>
  act(() => {
    el.value = value;
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });

test('guard exemption: Enter in an untouched filename box is ignored at 100 ms, confirms at 500 ms', async () => {
  const { dialogs } = await mount();
  const p = dialogs.saveFile({ title: 't', suggestedName: 'a.txt' });
  await settle();
  const el = root.querySelector('input') as HTMLInputElement;
  vi.advanceTimersByTime(100);
  await key(el, 'Enter');
  expect(dialogs.active.value).not.toBeNull();
  vi.advanceTimersByTime(400);
  await key(el, 'Enter');
  expect(await p).toBe('/home/user/Documents/a.txt');
});

test('guard exemption: after the user edits the filename, Enter confirms immediately', async () => {
  const { dialogs } = await mount();
  const p = dialogs.saveFile({ title: 't', suggestedName: 'a.txt' });
  await settle();
  const el = root.querySelector('input') as HTMLInputElement;
  vi.advanceTimersByTime(100);
  await input(el, 'hello');
  await key(el, 'Enter');
  expect(await p).toBe('/home/user/Documents/hello');
});

test('guard exemption is only for the input: a button click at 100 ms is still ignored', async () => {
  const { dialogs } = await mount();
  void dialogs.saveFile({ title: 't', suggestedName: 'a.txt' });
  await settle();
  const el = root.querySelector('input') as HTMLInputElement;
  vi.advanceTimersByTime(100);
  await input(el, 'hello');
  await act(() => (root.querySelector('.ew-file-bottom button') as HTMLButtonElement).click());
  expect(dialogs.active.value).not.toBeNull();
});

test('double-click on a file row is gated: ignored at 100 ms, resolves at 500 ms', async () => {
  const { dialogs, fs } = await mount();
  await fs.write('/home/user/Documents/f.txt', new Blob(['x']));
  const p = dialogs.openFile({ title: 't' });
  await settle();
  const row = () =>
    (Array.from(root.querySelectorAll('.ew-file-row')) as HTMLElement[]).find(
      (r) => r.textContent === 'f.txt',
    );
  const dbl = () =>
    act(() => {
      row()?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
  vi.advanceTimersByTime(100);
  await dbl();
  expect(dialogs.active.value).not.toBeNull();
  vi.advanceTimersByTime(400);
  await dbl();
  expect(await p).toEqual(['/home/user/Documents/f.txt']);
});

test('Save: double-clicking an existing file uses the clicked name, not stale state (once armed)', async () => {
  const { dialogs, fs } = await mount();
  await fs.write('/home/user/Documents/f.txt', new Blob(['x']));
  const p = dialogs.saveFile({ title: 't', suggestedName: 'other.txt' });
  await settle();
  vi.advanceTimersByTime(CONFIRM_GUARD_MS + 100);
  const row = (Array.from(root.querySelectorAll('.ew-file-row')) as HTMLElement[]).find(
    (r) => r.textContent === 'f.txt',
  );
  await act(() => {
    row?.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
  });
  expect(await p).toBe('/home/user/Documents/f.txt');
});
