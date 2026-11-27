import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark'] as const) {
  test(`${theme} welcome score teaches a hands-free gesture without starting setup`, async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 620 });
    await page.emulateMedia({ reducedMotion: theme === 'light' ? 'reduce' : 'no-preference' });
    await page.goto(`/tests/fixtures/guided-preview.html?step=0&theme=${theme}&ready=0`);
    // Model wider fallback fonts as well as the shipped Mac system stack.
    if (theme === 'light') await page.addStyleTag({ content: ':root { --font: Verdana, sans-serif; }' });
    const guide = page.getByRole('region', { name: 'Gesture guide' });
    await guide.getByRole('radio', { name: 'Hold to talk' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(guide.getByRole('radio', { name: 'Hands-free' })).toBeChecked();
    await expect(guide.getByText(/Double-tap, speak with the keys up/)).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(guide.getByRole('button', { name: 'Watch example' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(guide.getByText('Tracing gesture…')).toBeVisible();
    const head = await guide.locator('.gesture-score__keys').evaluate(el => getComputedStyle(el, '::after').animationName);
    expect(head).toBe(theme === 'light' ? 'none' : 'gesture-trace');
    await expect(guide.getByText('Meet me at noon.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Start setup/ })).toBeEnabled();
    const fits = await page.locator('.guided-content').evaluate(el => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth);
    expect(fits).toBe(true);
    expect((await new AxeBuilder({ page }).include('.setup-window').analyze()).violations).toEqual([]);
  });
}
