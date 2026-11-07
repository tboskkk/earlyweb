import { expect, test } from '@playwright/test';
import {
  appFrame,
  appWindows,
  launchFromStart,
  NOTEPAD,
  notepadSaveAs,
  openShell,
  sessionIdle,
  waitForDialogArmed,
} from './helpers.ts';

test('Notepad: type, save, survive a reload, reopen from disk', async ({ page }) => {
  await openShell(page);

  // 1–4: Start → Notepad, type, Ctrl+S, name it "hello", confirm.
  const win = await notepadSaveAs(page, 'Hello 2006', 'hello');
  await expect(win.locator('.ew-title')).toHaveText('hello.txt - Notepad');

  // 5: reload once the session save has been written.
  await sessionIdle(page);
  await page.reload();

  // 6: the restored Notepad window reopens hello.txt.
  const restored = appWindows(page, NOTEPAD);
  await expect(restored).toHaveCount(1);
  await expect(restored.locator('.ew-title')).toHaveText('hello.txt - Notepad');
  await expect(appFrame(restored).locator('#editor')).toHaveValue('Hello 2006');

  // 7: close it with the title-bar X, open a fresh Notepad and use Open… to load hello.txt.
  await restored.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(appWindows(page, NOTEPAD)).toHaveCount(0);

  await launchFromStart(page, 'Notepad');
  const fresh = appWindows(page, NOTEPAD);
  await expect(fresh).toHaveCount(1);
  await expect(fresh.locator('.ew-title')).toHaveText('Untitled - Notepad');
  const editor = appFrame(fresh).locator('#editor');
  await expect(editor).toHaveValue('');

  await appFrame(fresh).locator('#open').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const row = dialog.getByRole('option', { name: 'hello.txt', exact: true });
  await expect(row).toBeVisible();
  await waitForDialogArmed(page);
  await row.click();
  await expect(row).toHaveAttribute('aria-selected', 'true');
  await dialog.getByRole('button', { name: 'Open', exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(editor).toHaveValue('Hello 2006');
  await expect(fresh.locator('.ew-title')).toHaveText('hello.txt - Notepad');
});
