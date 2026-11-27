import { expect, test } from '@playwright/test';

for (const [width, height] of [[640, 620], [1470, 900]]) {
  test(`Settings leaves room for its controls beside the rail at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    if (width === 640) await page.addInitScript(() => Object.defineProperty(Navigator.prototype, 'platform', { get: () => 'Linux x86_64' }));
    await page.goto('/');
    if (width === 640) await page.addStyleTag({ content: ':root { --font: Verdana, sans-serif !important; }' });
    await page.getByRole('button', { name: 'Set up later' }).click();
    await page.getByRole('button', { exact: true, name: 'Settings' }).click();
    await expect(page.getByRole('button', { current: 'page', name: 'Settings' })).toBeInViewport();
    await expect(page.getByRole('button', { name: /Change keys$/ })).toBeInViewport({ ratio: 1 });
    const tabs = page.getByRole('tablist', { name: 'Settings sections' });
    await tabs.getByRole('tab', { selected: true }).focus();
    for (const name of ['Microphone', 'Speech', 'Cleanup', 'Output', 'Transcripts', 'Appearance']) {
      await page.keyboard.press('ArrowRight');
      const selected = tabs.getByRole('tab', { selected: true, name: new RegExp(`^${name}:`) });
      await expect(selected).toBeFocused();
      await expect(selected).toBeInViewport({ ratio: 1 });
      await expect(page.getByRole('tabpanel', { name: new RegExp(`^${name}:`) })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    }
  });
}
