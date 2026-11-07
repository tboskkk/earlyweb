import { expect, test } from '@playwright/test';
import {
  APP_ORIGIN,
  appFrame,
  appWindows,
  HOSTILE,
  launchFromStart,
  NOTEPAD,
  notepadSaveAs,
  openShell,
  waitForDialogArmed,
} from './helpers.ts';

const CHECKS = ['dialogNoPerm', 'forgedRef', 'localStorage', 'parentDom', 'readHome', 'traversal'];

test('hostile app without permissions is blocked at every escape attempt', async ({ page }) => {
  await openShell(page);

  // Make readHome meaningful: /home/user/Documents/hello.txt must really exist, so an
  // EPERM cannot be a disguised "not found". Create it through Notepad, then confirm it
  // shows up in the trusted Open dialog.
  const notepad = await notepadSaveAs(page, 'secret', 'hello');
  await expect(notepad.locator('.ew-title')).toHaveText('hello.txt - Notepad');
  await appFrame(notepad).locator('#open').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('option', { name: 'hello.txt', exact: true })).toBeVisible();
  await waitForDialogArmed(page);
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toBeHidden();
  await notepad.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(appWindows(page, NOTEPAD)).toHaveCount(0);

  // Start → Tests → Hostile Test App.
  await launchFromStart(page, 'Hostile Test App', 'Tests');
  const win = appWindows(page, HOSTILE);
  await expect(win).toHaveCount(1);

  // The frame really is sandboxed, cross-origin, and has no extra capabilities.
  const iframe = win.locator(`iframe[data-app="${HOSTILE}"]`);
  await expect(iframe).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(iframe).toHaveAttribute('allow', '');
  await expect(iframe).toHaveAttribute('referrerpolicy', 'no-referrer');
  const src = await iframe.getAttribute('src');
  expect(new URL(src ?? '').origin).toBe(APP_ORIGIN);

  const results = appFrame(win).locator('#results');
  await expect(results).not.toBeEmpty();
  const parsed = JSON.parse((await results.textContent()) ?? '') as Record<string, unknown>;
  expect(Object.keys(parsed).sort()).toEqual(CHECKS);
  for (const key of CHECKS) expect(parsed[key], key).toBe('blocked');
  await expect(appFrame(win).locator('#status')).toHaveText('All escape attempts were blocked.');
});
