import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

// Recall: one index for finding a dictation, a facing leaf for reading it.

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
  test(`the search field and reading sheet fit the toolbar at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ height: 620, width });
    await openShell(page);
    const tab = await box(page, '.recall__tab');
    const settings = await box(page, '.tb-settings');
    const rail = await box(page, '.sidebar');
    expect(tab.x).toBeGreaterThanOrEqual(rail.x + rail.width);
    expect(tab.x + tab.width).toBeLessThanOrEqual(settings.x);
    if (await page.locator('.titlebar__title').isVisible()) {
      const title = await box(page, '.titlebar__title');
      expect(tab.x).toBeGreaterThanOrEqual(title.x + title.width);
    }
    await field(page).click();
    // Measure once the sheet settles.
    await page.locator('.recall__sheet').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
    const sheet = await box(page, '.recall__sheet');
    expect(sheet.x).toBeGreaterThanOrEqual(rail.x + rail.width);
    expect(sheet.x + sheet.width).toBeLessThanOrEqual(width);
    expect(sheet.y + sheet.height).toBeLessThanOrEqual(620);
    const preview = await box(page, '.recall-leaf');
    const index = await box(page, '.recall__list');
    if (width === 640) expect(preview.y).toBeGreaterThanOrEqual(index.y + index.height - 1);
    else expect(preview.x).toBeGreaterThanOrEqual(index.x + index.width - 1);
    await expect(page.getByRole('button', { name: 'Copy passage' })).toBeInViewport();
    // The sheet lies over the page: nothing below the toolbar takes the click.
    const hit = await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest('.recall') !== null,
      [sheet.x + sheet.width / 2, sheet.y + 40]);
    expect(hit).toBe(true);
  });
}

test('keyboard selection stays in view in the stacked index', async ({ page }) => {
  await page.setViewportSize({ height: 620, width: 640 });
  await openShell(page);
  await page.keyboard.press('/');
  await page.keyboard.press('ArrowUp');
  const option = results(page).getByRole('option', { selected: true });
  await expect(option).toHaveAccessibleName('Settings');
  await expect(option).toBeInViewport({ ratio: 1 });
  await page.keyboard.press('ArrowDown');
  await expect(option).toHaveText(/Make retry explicit/);
  await expect(option).toBeInViewport({ ratio: 1 });
  await expect(field(page)).toBeFocused();
});

test('an unconfirmed day puts one caution on the selected passage, and opens the same History entry', async ({ page }) => {
  await openShell(page);
  await page.locator('.dev-panel > summary').click();
  await page.getByRole('button', { name: 'Empty lists' }).click();
  await page.getByRole('button', { name: '38 unconfirmed runs' }).click();
  await page.locator('.dev-panel > summary').click();
  await page.keyboard.press('/');
  const uncertain = results(page).getByRole('option', { name: /unverified/i });
  await expect(uncertain).toHaveCount(5);
  await uncertain.nth(2).click();
  const leaf = page.getByRole('region', { name: 'Passage preview' });
  const words = await leaf.getByRole('blockquote').innerText();
  await expect(leaf.getByText('Unverified', { exact: true })).toBeVisible();
  await expect(page.getByText('Check the destination before copying.')).toHaveCount(1);
  await leaf.getByRole('button', { name: 'Show in History' }).click();
  await expect(page.locator('.history-row:focus h3')).toHaveText(words);
  await expect(page.locator('.history-row:focus')).toHaveAttribute('data-status', 'unverified');
});

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
