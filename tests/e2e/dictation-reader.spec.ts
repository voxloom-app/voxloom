import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const colorScheme of ['light', 'dark'] as const) {
  test(`read and page through full dictations on Home (${colorScheme})`, async ({ page }, info) => {
    const narrow = colorScheme === 'light';
    await page.setViewportSize({ height: 620, width: narrow ? 640 : 1120 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.clock.setFixedTime(new Date(2026, 10, 26, 14));
    await page.goto('/');
    await page.getByRole('button', { name: 'Set up later' }).click();
    await page.locator('.dev-panel > summary').click();
    await page.getByRole('button', { name: '38 unconfirmed runs' }).click();
    await page.getByRole('button', { name: 'Long dictation' }).click();
    await page.locator('.dev-panel > summary').click();
    if (narrow) {
      await page.evaluate(() => { document.documentElement.dataset.textsize = 'large'; });
      await page.addStyleTag({ content: ':root { --font: Verdana, sans-serif; }' });
    }
    const last = page.getByRole('region', { name: 'Last dictation' });
    const fullText = await last.getByRole('blockquote').textContent();
    expect(fullText).toContain('\n\n');
    const opener = last.getByRole('button', { name: 'Read in full' });
    await opener.focus();
    await page.keyboard.press('Enter');
    const sheet = page.getByRole('dialog', { name: 'Recent dictations' });
    const words = sheet.getByRole('blockquote', { name: 'Full dictation' });
    await expect(words).toBeFocused();
    expect(await words.textContent()).toBe(fullText);
    await expect(words).toHaveCSS('white-space', 'pre-wrap');
    await expect(words).toHaveAccessibleDescription(/Unverified Check the destination before copying/);
    await expect(sheet.getByRole('button', { name: 'Newer' })).toBeDisabled();
    await expect(sheet.getByRole('button', { name: 'Older' })).toBeInViewport({ ratio: 1 });
    await expect(sheet.getByRole('button', { name: 'Copy text' })).toBeInViewport({ ratio: 1 });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: info.outputPath(`reader-${colorScheme}.png`) });
    // Read to the end without scrolling the dimmed window or moving focus.
    await page.keyboard.press('End');
    await expect.poll(() => words.evaluate((el) => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(1);
    await page.keyboard.press('Tab');
    await expect(sheet.getByRole('button', { name: 'Copy text' })).toBeFocused();
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await expect(words).toBeFocused();
    await expect(words).not.toHaveText(fullText!);
    await expect(words).toHaveAccessibleDescription(/^Dictation 2 of 6/);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
    await expect(opener).toBeFocused();
    await expect(page.getByRole('button', { name: 'Copy last dictation' })).toBeVisible();
  });
}
