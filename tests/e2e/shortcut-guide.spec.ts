import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const [colorScheme, width, platform] of [['light', 640, 'Linux x86_64'], ['dark', 1120, 'MacIntel']] as const) {
  test(`shortcut reference fits and plays without leaving the sheet (${colorScheme})`, async ({ page }) => {
    await page.setViewportSize({ width, height: 620 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'no-preference' });
    await page.addInitScript((value) => Object.defineProperty(Navigator.prototype, 'platform', { get: () => value }), platform);
    await page.goto('/');
    await page.getByRole('button', { name: 'Set up later' }).click();
    await page.addStyleTag({ content: ':root, body { --font: Verdana, sans-serif !important; }' });
    const opener = page.getByRole('button', { name: 'Open keyboard shortcuts' });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
    const play = dialog.getByRole('button', { name: 'Play example' });
    const hold = dialog.getByRole('radio', { name: 'Hold to talk' });
    await expect(dialog.getByRole('button', { name: 'Close Keyboard shortcuts' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(hold).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(play).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(dialog.locator('.shortcut-demo__keys')).toHaveAttribute('data-down', 'true');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('ArrowRight');
    await expect(dialog.getByRole('radio', { name: 'Hands-free' })).toBeFocused();
    await expect(dialog.getByText('Double-tap, speak with the keys up, then press once to finish.')).toBeVisible();
    await expect(play).toBeEnabled();
    await expect(dialog.locator('.shortcut-demo__keys')).not.toHaveAttribute('data-down');
    const fit = await dialog.locator('.overlay__panel').evaluate((el) => ({
      x: el.scrollWidth - el.clientWidth, y: el.scrollHeight - el.clientHeight,
    }));
    expect(fit).toEqual({ x: 0, y: 0 });
    const audit = await new AxeBuilder({ page }).analyze();
    expect(audit.violations).toEqual([]);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(play).toBeHidden();
    await expect(dialog.locator('.gesture-score')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(opener).toBeFocused();
    await expect(page.getByRole('button', { name: 'Start dictating' })).toBeVisible();
  });
}
