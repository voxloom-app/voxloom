import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const colorScheme of ['light', 'dark'] as const) {
  test(`collect, review and leave a temporary clipping sheet by keyboard (${colorScheme})`, async ({ page }, info) => {
    await page.setViewportSize({ width: colorScheme === 'light' ? 640 : 1120, height: 660 });
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.goto('/');
    await page.getByRole('button', { name: 'Set up later' }).click();
    const history = page.getByRole('button', { name: 'History', exact: true });
    await history.click();
    const clip = page.getByRole('button', { name: /^Clip passage from/ });
    const review = page.getByRole('button', { name: /^Open clipping sheet/ });
    for (const n of [0, 2, 4]) {
      await clip.nth(n).focus();
      await page.keyboard.press('Space');
      await expect(clip.nth(n)).toHaveAttribute('aria-pressed', 'true');
    }
    await expect(review).toBeInViewport();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await review.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Clipping sheet' });
    const passages = dialog.getByRole('listitem');
    await expect(passages).toHaveCount(3);
    await expect(passages.first()).toContainText('Open src/auth/session.ts');
    await expect(passages.last()).toContainText('Make retry explicit');
    await expect(dialog.getByRole('button', { name: 'Close Clipping sheet' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('list')).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(dialog.getByRole('button', { name: 'Copy passages' })).toBeFocused();
    await page.screenshot({ path: info.outputPath(`clipping-sheet-${colorScheme}.png`) });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.keyboard.press('Escape');
    await expect(review).toBeFocused();
    await page.getByRole('button', { name: 'Home', exact: true }).click();
    await history.click();
    await expect(review).toHaveAccessibleName('Open clipping sheet, 0 passages');
  });
}
