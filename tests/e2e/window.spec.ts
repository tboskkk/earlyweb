import { expect, type Locator, type Page, test } from '@playwright/test';
import { appWindows, launchFromStart, NOTEPAD, openShell } from './helpers.ts';

type Point = { x: number; y: number };
type Box = Point & { width: number; height: number };

async function box(l: Locator): Promise<Box> {
  const b = await l.boundingBox();
  if (!b) throw new Error('element has no bounding box');
  return b;
}

async function drag(page: Page, from: Point, dx: number, dy: number, steps: number) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + dx, from.y + dy, { steps });
  await page.mouse.up();
}

/** True if the topmost element at `p` is `el` or inside it. */
const hits = (el: Locator, p: Point) =>
  el.evaluate((node, { x, y }) => {
    const top = document.elementFromPoint(x, y);
    return top !== null && node.contains(top);
  }, p);

/**
 * Opens Notepads A and B, then parks B (on top) so that its iframe covers A's title-bar
 * row from 120 px right of A's grab point onwards. Returns A and the grab point.
 */
async function setupOverlap(page: Page): Promise<{ a: Locator; b: Locator; grab: Point }> {
  await openShell(page);
  await launchFromStart(page, 'Notepad');
  await launchFromStart(page, 'Notepad');
  const wins = appWindows(page, NOTEPAD);
  await expect(wins).toHaveCount(2);
  const a = wins.nth(0);
  const b = wins.nth(1);
  await expect(a).toBeVisible();
  await expect(b).toBeVisible();

  const a0 = await box(a);
  const aT = await box(a.locator('.ew-titlebar'));
  const grab = { x: a0.x + 60, y: aT.y + aT.height / 2 };
  const b0 = await box(b);
  const bT = await box(b.locator('.ew-titlebar'));
  const bTarget = { x: grab.x + 120, y: aT.y - bT.height - 4 };
  await drag(page, { x: bT.x + 200, y: bT.y + bT.height / 2 }, bTarget.x - b0.x, bTarget.y - b0.y, 10);
  const b1 = await box(b);
  expect(Math.abs(b1.x - bTarget.x)).toBeLessThanOrEqual(2);
  expect(Math.abs(b1.y - bTarget.y)).toBeLessThanOrEqual(2);

  // The grab point is on A's title bar, not covered by B.
  expect(await hits(a.locator('.ew-titlebar'), grab)).toBe(true);
  return { a, b, grab };
}

// Review Focus 1: a title-bar drag must keep tracking while the pointer crosses
// another window's iframe (iframes would otherwise swallow the pointer events).
test('dragging a window across another window’s iframe moves it exactly', async ({ page }) => {
  const { a, b, grab } = await setupOverlap(page);

  // The pointer path (grab → grab + 300 px) really crosses B's iframe.
  const bFrame = b.locator('iframe');
  const f = await box(bFrame);
  const pathEnd = { x: grab.x + 300, y: grab.y };
  expect(f.y).toBeLessThan(grab.y);
  expect(f.y + f.height).toBeGreaterThan(grab.y);
  expect(f.x).toBeGreaterThan(grab.x);
  expect(f.x).toBeLessThan(pathEnd.x);
  expect(await hits(bFrame, pathEnd)).toBe(true);

  const before = await box(a);
  await drag(page, grab, 300, 0, 10);
  const after = await box(a);
  expect(Math.abs(after.x - before.x - 300)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
});

// The stepped drag above never actually puts the pointer over B's iframe at event time
// (A is raised on pointerdown and follows each 30 px step). Here a single move jumps past
// A's right edge, so the pointermove is dispatched where B's iframe is the topmost element:
// without pointer capture the iframe would swallow it and A would not move.
test('a drag whose pointer outruns the title bar onto another iframe still moves the window', async ({
  page,
}) => {
  const { a, b, grab } = await setupOverlap(page);
  const a0 = await box(a);
  const jump = Math.ceil(a0.x + a0.width - grab.x) + 60; // lands 60 px beyond A's right edge
  const landing = { x: grab.x + jump, y: grab.y };

  // Before the drag, while A is raised: the landing point is outside A and on B's iframe.
  await page.mouse.click(grab.x, grab.y);
  await expect(a).toHaveClass(/ew-focused/);
  expect(await hits(a, landing)).toBe(false);
  expect(await hits(b.locator('iframe'), landing)).toBe(true);

  await drag(page, grab, jump, 0, 1);
  const after = await box(a);
  expect(Math.abs(after.x - a0.x - jump)).toBeLessThanOrEqual(2);
  expect(Math.abs(after.y - a0.y)).toBeLessThanOrEqual(2);
});
