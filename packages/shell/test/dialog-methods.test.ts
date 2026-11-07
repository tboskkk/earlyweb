import 'fake-indexeddb/auto';
import { createIdbFs, createMemoryKv, ensureHome } from '@earlyweb/backends';
import { EwError, type Manifest } from '@earlyweb/protocol';
import { expect, test, vi } from 'vitest';
import { dialogHandlers } from '../src/broker/methods/dialog.ts';
import type { DialogService } from '../src/dialogs/dialog-service.ts';
import { validateSaveName } from '../src/dialogs/save-validation.ts';
import { createGrantTable } from '../src/services/grants.ts';

let n = 0;
const ctx = (appId = 'org.x.app') => ({
  instance: {
    instanceId: `inst-${appId}`,
    appId,
    manifest: { name: 'My App', permissions: [] } as unknown as Manifest,
    windowId: 'w',
    launch: { args: [] },
  },
});

async function setup(isLive?: (id: string) => boolean) {
  const fs = await createIdbFs(`dlg-${n++}`);
  await ensureHome(fs);
  const grants = await createGrantTable(createMemoryKv());
  const dialogs = {
    openFile: vi.fn(),
    saveFile: vi.fn(),
    message: vi.fn(),
  } as unknown as DialogService & {
    openFile: ReturnType<typeof vi.fn>;
    saveFile: ReturnType<typeof vi.fn>;
    message: ReturnType<typeof vi.fn>;
  };
  const onGrant = vi.fn();
  const issue = vi.spyOn(grants, 'issue');
  const h = dialogHandlers({ dialogs, grants, fs, onGrant, isLive });
  return { fs, grants, dialogs, onGrant, issue, h };
}

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof EwError ? e.code : 'other';
  }
  return 'none';
};

test('dialog.open issues grants for the picked paths, for this app only', async () => {
  const { h, dialogs, grants, onGrant, fs } = await setup();
  await fs.write('/home/user/Documents/a.txt', new Blob(['x']));
  dialogs.openFile.mockResolvedValue(['/home/user/Documents/a.txt']);
  const res = (await h['dialog.open']?.(ctx(), {})) as { id: string; name: string }[];
  expect(res).toEqual([{ id: expect.stringMatching(/^g_/), name: 'a.txt' }]);
  expect(grants.resolve('org.x.app', res[0]?.id as string)).toBe('/home/user/Documents/a.txt');
  expect(() => grants.resolve('org.y.app', res[0]?.id as string)).toThrow();
  expect(dialogs.openFile).toHaveBeenCalledWith(expect.objectContaining({ appName: 'My App' }));
  expect(onGrant).toHaveBeenCalledTimes(1);
  expect(onGrant).toHaveBeenCalledWith('inst-org.x.app', res[0]);
});

test('onGrant fires for each picked ref, in order', async () => {
  const { h, dialogs, onGrant, fs } = await setup();
  await fs.write('/home/user/a', new Blob(['x']));
  await fs.write('/home/user/b', new Blob(['x']));
  dialogs.openFile.mockResolvedValue(['/home/user/a', '/home/user/b']);
  const res = (await h['dialog.open']?.(ctx(), { multiple: true })) as unknown[];
  expect(onGrant.mock.calls.map((c) => c[1])).toEqual(res);
});

test('null pick -> null and no grant callback', async () => {
  const { h, dialogs, onGrant } = await setup();
  dialogs.openFile.mockResolvedValue(null);
  expect(await h['dialog.open']?.(ctx(), {})).toBeNull();
  dialogs.saveFile.mockResolvedValue(null);
  expect(await h['dialog.save']?.(ctx(), {})).toBeNull();
  expect(onGrant).not.toHaveBeenCalled();
});

test('dialog.save on a new path grants without asking', async () => {
  const { h, dialogs, onGrant } = await setup();
  dialogs.saveFile.mockResolvedValue('/home/user/Documents/new.txt');
  const res = (await h['dialog.save']?.(ctx(), {})) as { id: string; name: string };
  expect(res).toEqual({ id: expect.stringMatching(/^g_/), name: 'new.txt' });
  expect(dialogs.message).not.toHaveBeenCalled();
  expect(onGrant).toHaveBeenCalledWith('inst-org.x.app', res);
});

test('dialog.save over an existing file asks first; No -> null, Yes -> FileRef', async () => {
  const { h, dialogs, fs, onGrant, issue } = await setup();
  await fs.write('/home/user/Documents/a.txt', new Blob(['x']));
  dialogs.saveFile.mockResolvedValue('/home/user/Documents/a.txt');
  dialogs.message.mockResolvedValue('No');
  expect(await h['dialog.save']?.(ctx(), {})).toBeNull();
  expect(dialogs.message).toHaveBeenCalledWith(
    expect.objectContaining({
      text: 'a.txt already exists.\nDo you want to replace it?',
      icon: 'warning',
      buttons: ['Yes', 'No'],
    }),
  );
  expect(onGrant).not.toHaveBeenCalled();
  expect(issue).not.toHaveBeenCalled();
  expect(dialogs.message).toHaveBeenCalledWith(expect.objectContaining({ defaultButton: 'No' }));
  dialogs.message.mockResolvedValue('Yes');
  const res = (await h['dialog.save']?.(ctx(), {})) as { id: string; name: string };
  expect(res.id).toMatch(/^g_/);
  expect(res.name).toBe('a.txt');
  expect(onGrant).toHaveBeenCalledTimes(1);
});

test('dialog.save refuses to replace a directory or write under a missing dir', async () => {
  const { h, dialogs, onGrant, issue } = await setup();
  dialogs.saveFile.mockResolvedValue('/home/user/Documents');
  expect(await code(h['dialog.save']?.(ctx(), {}) as Promise<unknown>)).toBe('EINVAL');
  dialogs.saveFile.mockResolvedValue('/home/user/nope/a.txt');
  expect(await code(h['dialog.save']?.(ctx(), {}) as Promise<unknown>)).toBe('ENOENT');
  expect(dialogs.message).not.toHaveBeenCalled();
  expect(issue).not.toHaveBeenCalled();
  expect(onGrant).not.toHaveBeenCalled();
});

test('defensive re-validation: a buggy dialog UI cannot get a grant for a weird name', async () => {
  const { h, dialogs, onGrant, issue } = await setup();
  for (const bad of [
    `/home/user/Documents/${'a'.repeat(256)}`,
    '/home/user/Documents/',
    '/home/user/Documents/..',
    '/home/user/Documents/./a.txt',
    '/home/user/Documents/a\u0000b',
    'relative.txt',
    '/home/x.txt',
    '/home/user',
    '/etc/passwd',
  ]) {
    dialogs.saveFile.mockResolvedValue(bad);
    expect(await code(h['dialog.save']?.(ctx(), {}) as Promise<unknown>)).toBe('EINVAL');
  }
  expect(onGrant).not.toHaveBeenCalled();
  expect(issue).not.toHaveBeenCalled();
});

test('hostile filter extension cannot escape the browsed folder (validation and handler)', async () => {
  const { h, dialogs, onGrant, issue } = await setup();
  const hostile = [{ name: 'x', extensions: ['/../../../x.txt'] }];
  // what the dialog would now produce for "notes": the unsafe extension is ignored
  expect(validateSaveName('notes', hostile)).toEqual({ ok: true, name: 'notes' });
  // a buggy/old UI that did append it yields a path that normalizes outside the folder
  dialogs.saveFile.mockResolvedValue('/home/x.txt');
  expect(await code(h['dialog.save']?.(ctx(), { filters: hostile }) as Promise<unknown>)).toBe('EINVAL');
  dialogs.saveFile.mockResolvedValue('/home/user/Documents/notes./../../../x.txt');
  expect(await code(h['dialog.save']?.(ctx(), { filters: hostile }) as Promise<unknown>)).toBe('EINVAL');
  expect(issue).not.toHaveBeenCalled();
  expect(onGrant).not.toHaveBeenCalled();
});

test('dialog.open only grants files: a directory pick is EINVAL and nothing is granted', async () => {
  const { h, dialogs, fs, onGrant, issue } = await setup();
  await fs.write('/home/user/Documents/ok.txt', new Blob(['x']));
  dialogs.openFile.mockResolvedValue(['/home/user/Documents/ok.txt', '/home/user/Documents']);
  expect(await code(h['dialog.open']?.(ctx(), {}) as Promise<unknown>)).toBe('EINVAL');
  dialogs.openFile.mockResolvedValue(['/home/user/Documents/missing.txt']);
  expect(await code(h['dialog.open']?.(ctx(), {}) as Promise<unknown>)).toBe('EINVAL');
  dialogs.openFile.mockResolvedValue(['/etc/passwd']);
  expect(await code(h['dialog.open']?.(ctx(), {}) as Promise<unknown>)).toBe('EINVAL');
  expect(issue).not.toHaveBeenCalled();
  expect(onGrant).not.toHaveBeenCalled();
});

test('dialogs are attributed to the requesting instance', async () => {
  const { h, dialogs } = await setup();
  dialogs.message.mockResolvedValue('OK');
  await h['dialog.message']?.(ctx(), { title: 't', text: 'x' });
  expect(dialogs.message).toHaveBeenCalledWith(expect.objectContaining({ instanceId: 'inst-org.x.app' }));
});

test('dialog.message text: control and bidi stripped (newline/tab kept), capped at 2000', async () => {
  const { h, dialogs } = await setup();
  dialogs.message.mockResolvedValue('OK');
  await h['dialog.message']?.(ctx(), { title: 't', text: 'a\u0007b\u202Ec\nd\te' });
  expect(dialogs.message).toHaveBeenLastCalledWith(expect.objectContaining({ text: 'abc\nd\te' }));
  await h['dialog.message']?.(ctx(), { title: 't', text: 'z'.repeat(5000) });
  const sent = dialogs.message.mock.calls.at(-1)?.[0].text as string;
  expect(sent.length).toBeLessThanOrEqual(2000);
});

test('dialog.message defaults buttons to OK and returns the clicked label', async () => {
  const { h, dialogs, onGrant } = await setup();
  dialogs.message.mockResolvedValue('OK');
  expect(await h['dialog.message']?.(ctx(), { title: 't', text: 'x' })).toBe('OK');
  expect(dialogs.message).toHaveBeenCalledWith(
    expect.objectContaining({ buttons: ['OK'], appName: 'My App' }),
  );
  expect(onGrant).not.toHaveBeenCalled();
});

test('dialog.message sanitizes the title and rejects a label that was not offered', async () => {
  const { h, dialogs } = await setup();
  dialogs.message.mockResolvedValue('Hacked');
  expect(
    await code(
      h['dialog.message']?.(ctx(), { title: 't', text: 'x', buttons: ['A', 'B'] }) as Promise<unknown>,
    ),
  ).toBe('EINVAL');
  dialogs.message.mockResolvedValue('A');
  await h['dialog.message']?.(ctx(), { title: '‮abc\u0007', text: 'x', buttons: ['A'] });
  expect(dialogs.message).toHaveBeenLastCalledWith(expect.objectContaining({ title: 'abc' }));
});

test('instance ending after the stat: no prompt is queued and nothing is granted', async () => {
  let live = true;
  const { h, dialogs, fs, onGrant, issue } = await setup(() => live);
  await fs.write('/home/user/Documents/a.txt', new Blob(['x']));
  // the instance ends while the handler is between its stat and the overwrite prompt
  dialogs.saveFile.mockImplementation(async () => {
    queueMicrotask(() => {});
    return '/home/user/Documents/a.txt';
  });
  const realStat = fs.stat.bind(fs);
  let calls = 0;
  fs.stat = async (p: string) => {
    const r = await realStat(p);
    if (++calls === 2) live = false; // second stat = the existing-file check
    return r;
  };
  expect(await code(h['dialog.save']?.(ctx(), {}) as Promise<unknown>)).toBe('ECANCELED');
  expect(dialogs.message).not.toHaveBeenCalled();
  expect(issue).not.toHaveBeenCalled();
  expect(onGrant).not.toHaveBeenCalled();
});

test('instance ending while the overwrite prompt is up: Yes issues nothing', async () => {
  let live = true;
  const { h, dialogs, fs, onGrant, issue } = await setup(() => live);
  await fs.write('/home/user/Documents/a.txt', new Blob(['x']));
  dialogs.saveFile.mockResolvedValue('/home/user/Documents/a.txt');
  dialogs.message.mockImplementation(async () => {
    live = false;
    return 'Yes';
  });
  expect(await code(h['dialog.save']?.(ctx(), {}) as Promise<unknown>)).toBe('ECANCELED');
  expect(issue).not.toHaveBeenCalled();
  expect(onGrant).not.toHaveBeenCalled();
});

test('instance ending during dialog.open stat: nothing is granted', async () => {
  let live = true;
  const { h, dialogs, fs, issue } = await setup(() => live);
  await fs.write('/home/user/Documents/a.txt', new Blob(['x']));
  dialogs.openFile.mockResolvedValue(['/home/user/Documents/a.txt']);
  const realStat = fs.stat.bind(fs);
  fs.stat = async (p: string) => {
    const r = await realStat(p);
    live = false;
    return r;
  };
  expect(await code(h['dialog.open']?.(ctx(), {}) as Promise<unknown>)).toBe('ECANCELED');
  expect(issue).not.toHaveBeenCalled();
});
