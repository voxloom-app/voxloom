import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test.use({ timezoneId: 'America/New_York' });

// ui-iter-39: History opens on the words. The hour turns are marked in the time margin
// (no time cards above the list), and a day of Unverified rows reads as words, not icons.
for (const colorScheme of ['light', 'dark'] as const) {
  test(`hour marks and a quiet ledger in a busy unverified day (${colorScheme})`, async ({ page }, info) => {
    const wide = colorScheme === 'dark';
    await page.setViewportSize({ height: 660, width: wide ? 1120 : 640 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.clock.setFixedTime(new Date('2026-11-26T14:00:00-05:00'));
    await page.goto('/');
    await page.getByRole('button', { name: 'Set up later' }).click();
    await page.locator('.dev-panel > summary').click();
    await page.getByRole('button', { name: 'Empty lists' }).click();
    await page.getByRole('button', { name: '38 unconfirmed runs' }).click();
    await page.locator('.dev-panel > summary').click();
    await page.getByRole('button', { name: 'History', exact: true }).click();
    if (!wide) {
      await page.evaluate(() => { document.documentElement.dataset.textsize = 'large'; });
    }
    await expect(page.getByRole('navigation', { name: 'Time index' })).toHaveCount(0);
    const marks = page.locator('.history-hour');
    await expect(marks).toHaveText(['1 PM', '12 PM', '11 AM']);
    const rows = page.locator('.history-row[data-status="unverified"]');
    await expect(rows).toHaveCount(38);
    await expect(page.getByText(/Couldn’t confirm they were typed/)).toHaveCount(1);
    const filter = page.getByRole('radiogroup', { name: 'History status' });
    await expect(filter.getByRole('radio', { name: 'Unverified 38' })).toBeVisible();
    // The first words sit near the top of the window, under one line of tools.
    const first = rows.first();
    await expect(first).toBeInViewport({ ratio: 1 });
    expect((await first.boundingBox())!.y).toBeLessThan(wide ? 300 : 420);
    if (wide) {
      // Tools wait for hover or focus; the day's caution already said why to check.
      const tools = first.getByRole('group', { name: 'Transcript actions' });
      await expect(tools).toHaveCSS('opacity', '0');
      await first.hover();
      await expect(tools).toHaveCSS('opacity', '1');
      await page.mouse.move(2, 2);
    }
    expect(await new AxeBuilder({ page }).analyze().then((result) => result.violations)).toEqual([]);
    await page.screenshot({ path: info.outputPath(`hour-marks-${colorScheme}.png`) });

    // Read into the 12 PM hour: its mark rides the top of the margin and covers the 1 PM mark.
    const noon = marks.nth(1);
    const deep = rows.filter({ has: page.locator('.timestamp', { hasText: '12:20 PM' }) });
    await deep.evaluate((row) => row.scrollIntoView({ block: 'center' }));
    const top = await noon.evaluate((mark) => mark.getBoundingClientRect().top);
    expect(top).toBeGreaterThanOrEqual(0);
    expect(top).toBeLessThan(2);
    await expect(noon).toBeInViewport();
    // The 1 PM pill is stuck in the same spot underneath, so none of it peeks out.
    const pill = (i: number) => marks.nth(i).locator('span').evaluate((span) => span.getBoundingClientRect().top);
    expect(await pill(0)).toBeCloseTo(await pill(1), 0);
    await page.screenshot({ path: info.outputPath(`hour-marks-scrolled-${colorScheme}.png`) });

    const target = rows.filter({ has: page.locator('.timestamp', { hasText: '11:56 AM' }) });
    await target.focus();
    await expect(target).toBeInViewport();
    await page.keyboard.press('Tab');
    const stamp = target.getByRole('button', { name: 'Recording details, 11:56 AM, Unverified' });
    await expect(stamp).toBeFocused();
    await page.keyboard.press('Enter');
    const slip = target.getByRole('region', { name: 'Recording details at 11:56 AM' });
    await expect(slip.getByText('Unverified')).toBeVisible();
    await expect(slip.getByText('Speech model')).toBeVisible();
    await expect(rows.locator('.recording-slip:visible')).toHaveCount(1);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(page.viewportSize()!.width);
    await page.screenshot({ path: info.outputPath(`recording-slip-${colorScheme}.png`) });
    await page.keyboard.press('Space');
    await expect(slip).toBeHidden();
    await page.keyboard.press('Tab');
    const copy = target.getByRole('button', { name: 'Copy transcript' });
    await expect(copy).toBeFocused();
    await expect(target.getByRole('group', { name: 'Transcript actions' })).toHaveCSS('opacity', '1');
  });
}
