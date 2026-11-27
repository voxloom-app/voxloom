import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.use({ timezoneId: 'America/New_York' });

for (const colorScheme of ['light', 'dark'] as const) {
  test(`a time card lands in a busy unverified day (${colorScheme})`, async ({ page }, info) => {
    await page.setViewportSize({ height: 660, width: colorScheme === 'light' ? 640 : 1120 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.clock.setFixedTime(new Date('2026-11-26T14:00:00-05:00'));
    await page.goto('/');
    await page.getByRole('button', { name: 'Set up later' }).click();
    await page.locator('.dev-panel > summary').click();
    await page.getByRole('button', { name: 'Empty lists' }).click();
    await page.getByRole('button', { name: '38 unconfirmed runs' }).click();
    await page.locator('.dev-panel > summary').click();
    await page.getByRole('button', { name: 'History', exact: true }).click();
    if (colorScheme === 'light') {
      await page.evaluate(() => { document.documentElement.dataset.textsize = 'large'; });
    }
    const cards = page.getByRole('navigation', { name: 'Time index' });
    const eleven = cards.getByRole('button', { name: 'Jump to 11 AM, 8 dictations' });
    await expect(cards.getByRole('button')).toHaveCount(3);
    await expect(eleven).toBeInViewport({ ratio: 1 });
    // Even the narrow, large-type layout keeps the occupied hours on one strip.
    const tops = await cards.getByRole('button').evaluateAll((buttons) => buttons.map((b) => b.getBoundingClientRect().top));
    expect(Math.max(...tops) - Math.min(...tops)).toBeLessThan(1);
    const rows = page.locator('.history-row[data-status="unverified"]');
    await expect(rows).toHaveCount(38);
    await expect(page.getByText(/Couldn’t confirm they were typed/)).toHaveCount(1);
    await expect(cards).not.toContainText(/unverified/i);
    expect(await new AxeBuilder({ page }).analyze().then((result) => result.violations)).toEqual([]);
    await page.screenshot({ path: info.outputPath(`time-cards-${colorScheme}.png`) });
    await eleven.focus();
    await page.keyboard.press('Enter');
    const target = rows.filter({ has: page.locator('.timestamp', { hasText: '11:56 AM' }) });
    await expect(target).toBeFocused();
    await expect(target).toBeInViewport({ ratio: 1 });
    await expect(rows).toHaveCount(38); // jumping isn't filtering
    await page.keyboard.press('Tab');
    await expect(target.getByRole('button', { name: 'Copy transcript' })).toBeFocused();
  });
}
