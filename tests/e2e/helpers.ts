import { expect, type FrameLocator, type Locator, type Page } from '@playwright/test';

export const NOTEPAD = 'org.earlyweb.notepad';
export const HOSTILE = 'test.earlyweb.hostile';
export const APP_ORIGIN = 'http://127.0.0.1:5174';

type EwHooks = { sessionIdle(): Promise<void> };

/** Loads the shell and waits until the app catalog has populated the start menu. */
export async function openShell(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.locator('.ew-start')).toBeVisible();
}

/** Start → (category) → app. Asserts the app is listed under the given category heading. */
export async function launchFromStart(page: Page, appName: string, category?: string): Promise<void> {
  await page.locator('.ew-start').click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const item = menu.getByRole('menuitem', { name: appName, exact: true });
  if (category) {
    const group = menu
      .locator('div')
      .filter({ has: page.getByRole('heading', { name: category, exact: true }) });
    await expect(group.getByRole('menuitem', { name: appName, exact: true })).toBeVisible();
  }
  await item.click();
  await expect(menu).toBeHidden();
}

/** The window frames hosting the given app, in DOM (= open) order. */
export function appWindows(page: Page, appId: string): Locator {
  return page.locator('.ew-window').filter({ has: page.locator(`iframe[data-app="${appId}"]`) });
}

export function appFrame(win: Locator): FrameLocator {
  return win.locator('iframe').contentFrame();
}

/**
 * Trusted dialogs ignore Enter/Space/click confirmations for CONFIRM_GUARD_MS (400 ms)
 * after they open (keystroke-jacking guard in packages/shell/src/dialogs/dialog-service.ts).
 * Wait it out before clicking rows/buttons. Typing a filename then Enter needs no wait.
 */
export async function waitForDialogArmed(page: Page): Promise<void> {
  await page.waitForTimeout(450);
}

/** Resolves once pending session saves have been written (DEV-only shell hook). */
export async function sessionIdle(page: Page): Promise<void> {
  await page.evaluate(() => (window as unknown as { __ew: EwHooks }).__ew.sessionIdle());
}

/**
 * Opens a new Notepad, types `text`, saves it with Ctrl+S as `name` (in the default
 * Documents folder) and returns its window. Asserts the title shows the saved file.
 */
export async function notepadSaveAs(page: Page, text: string, name: string): Promise<Locator> {
  const before = await appWindows(page, NOTEPAD).count();
  await launchFromStart(page, 'Notepad');
  const win = appWindows(page, NOTEPAD).nth(before);
  await expect(win).toBeVisible();
  await expect(win.locator('.ew-title')).toHaveText('Untitled - Notepad');

  const editor = appFrame(win).locator('#editor');
  await editor.click();
  await editor.pressSequentially(text);
  await expect(editor).toHaveValue(text);
  await expect(win.locator('.ew-title')).toHaveText('*Untitled - Notepad');

  await page.keyboard.press('Control+s');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const filename = dialog.getByRole('textbox');
  await expect(filename).toBeFocused();
  await filename.fill(name);
  await filename.press('Enter');
  await expect(dialog).toBeHidden();
  return win;
}
