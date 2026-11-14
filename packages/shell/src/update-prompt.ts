// The "an update is ready" prompt. Rust checks for updates in the background
// (src-tauri/src/update.rs) and emits `ew://update-available`; the user decides when.
import { type Invoke, toEwError } from '@earlyweb/backends';
import type { DialogService } from './dialogs/dialog-service.ts';

const TITLE = 'EarlyWeb Update';

export async function onUpdateAvailable(
  version: string,
  deps: { dialogs: DialogService; invoke: Invoke },
): Promise<void> {
  const choice = await deps.dialogs.message({
    title: TITLE,
    text: `EarlyWeb ${version} is ready to install. EarlyWeb will restart.`,
    icon: 'info',
    buttons: ['Restart Now', 'Later'],
    defaultButton: 'Restart Now',
  });
  if (choice !== 'Restart Now') return;
  try {
    await deps.invoke('update_install'); // restarts the app on success
  } catch (e) {
    await deps.dialogs.message({
      title: TITLE,
      text: `The update could not be installed: ${toEwError(e).message}`,
      icon: 'error',
    });
  }
}
