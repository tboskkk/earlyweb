import type { Invoke } from '@earlyweb/backends';
import { expect, test } from 'vitest';
import type { DialogService } from '../src/dialogs/dialog-service.ts';
import { onUpdateAvailable } from '../src/update-prompt.ts';

type Msg = Parameters<DialogService['message']>[0];

function fakes(answer: string, installFails = false) {
  const messages: Msg[] = [];
  const calls: string[] = [];
  const dialogs = {
    message: async (o: Msg) => {
      messages.push(o);
      return messages.length === 1 ? answer : 'OK';
    },
  } as unknown as DialogService;
  const invoke: Invoke = async (cmd) => {
    calls.push(cmd);
    if (installFails) throw { code: 'EINVAL', message: 'download failed' };
    return null;
  };
  return { messages, calls, dialogs, invoke };
}

test('Restart Now installs', async () => {
  const f = fakes('Restart Now');
  await onUpdateAvailable('0.1.1', { dialogs: f.dialogs, invoke: f.invoke });
  expect(f.messages[0]).toEqual({
    title: 'EarlyWeb Update',
    text: 'EarlyWeb 0.1.1 is ready to install. EarlyWeb will restart.',
    icon: 'info',
    buttons: ['Restart Now', 'Later'],
    defaultButton: 'Restart Now',
  });
  expect(f.calls).toEqual(['update_install']);
});

test('Later does nothing', async () => {
  const f = fakes('Later');
  await onUpdateAvailable('0.1.1', { dialogs: f.dialogs, invoke: f.invoke });
  expect(f.calls).toEqual([]);
  expect(f.messages).toHaveLength(1);
});

test('install failure shows an error box and keeps running', async () => {
  const f = fakes('Restart Now', true);
  await expect(onUpdateAvailable('0.1.1', { dialogs: f.dialogs, invoke: f.invoke })).resolves.toBeUndefined();
  expect(f.calls).toEqual(['update_install']);
  expect(f.messages).toHaveLength(2);
  expect(f.messages[1]?.icon).toBe('error');
  expect(f.messages[1]?.title).toBe('EarlyWeb Update');
  expect(f.messages[1]?.text).toContain('download failed');
});
