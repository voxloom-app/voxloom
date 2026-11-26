import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

// Recall (ui-iter-11): the toolbar's shuttle finds anything you've said.

async function openShell(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Set up later' }).click();
}

const field = (page: Page) => page.getByRole('combobox', { name: 'Recall what you said' });
const results = (page: Page) => page.getByRole('listbox', { name: 'Recall results' });

async function box(page: Page, selector: string) {
  const rect = await page.locator(selector).first().boundingBox();
  if (!rect) throw new Error(`${selector} has no box`);
  return rect;
}

for (const colorScheme of ['dark', 'light'] as const) {
  test(`Recall opens from the keyboard and stays accessible (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ height: 760, width: 1120 });
    await openShell(page);
    await page.keyboard.press('ControlOrMeta+k');
    await expect(field(page)).toBeFocused();
    await expect(results(page)).toBeVisible();
    await expect(results(page).getByRole('option')).toHaveCount(9);
    const axe = await new AxeBuilder({ page }).analyze();
    expect(axe.violations.filter(({ impact }) => impact === 'critical' || impact === 'serious')).toEqual([]);
    await page.keyboard.type('deploy');
    await expect(results(page).getByRole('group', { name: 'Dictations' }).getByRole('option')).toHaveCount(1);
    await expect(page.locator('.recall__words mark')).toHaveText('deploy');
    await page.keyboard.press('Escape');
    await expect(results(page)).toHaveCount(0);
    await expect(field(page)).not.toBeFocused();
  });
}

test('Shift+Enter lands on the dictation in History', async ({ page }) => {
  await openShell(page);
  await page.keyboard.press('/');
  await expect(field(page)).toBeFocused();
  await page.keyboard.type('rowan');
  await page.keyboard.press('Shift+Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'History' })).toBeVisible();
  await expect(page.locator('.history-row[data-record="record-4"]')).toBeFocused();
});

for (const width of [1120, 640]) {
  test(`the shuttle and its sheet fit the toolbar at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ height: 620, width });
    await openShell(page);
    const shuttle = await box(page, '.recall__shuttle');
    const settings = await box(page, '.tb-settings');
    const rail = await box(page, '.sidebar');
    expect(shuttle.x).toBeGreaterThanOrEqual(rail.x + rail.width);
    expect(shuttle.x + shuttle.width).toBeLessThanOrEqual(settings.x);
    if (await page.locator('.titlebar__title').isVisible()) {
      const title = await box(page, '.titlebar__title');
      expect(shuttle.x).toBeGreaterThanOrEqual(title.x + title.width);
    }
    await field(page).click();
    // Measure once the sheet has finished dropping (its clip-path animation also clips hit testing).
    await page.locator('.recall__sheet').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const sheet = await box(page, '.recall__sheet');
    expect(sheet.x).toBeGreaterThanOrEqual(rail.x + rail.width);
    expect(sheet.x + sheet.width).toBeLessThanOrEqual(width);
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(620);
    // The sheet lies over the page: nothing below the toolbar takes the click.
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.recall') !== null,
      [sheet.x + sheet.width / 2, sheet.y + 40]);
    expect(hit).toBe(true);
  });
}

test('Recall stays still under reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openShell(page);
  await page.keyboard.press('ControlOrMeta+k');
  await expect(results(page)).toBeVisible();
  const motion = await page.evaluate(() => ({
    recall: getComputedStyle(document.querySelector('.recall')!).transitionProperty,
    scrim: getComputedStyle(document.querySelector('.recall__scrim')!).animationName,
    sheet: getComputedStyle(document.querySelector('.recall__sheet')!).animationName,
  }));
  expect(motion).toEqual({ recall: 'none', scrim: 'none', sheet: 'none' });
});
