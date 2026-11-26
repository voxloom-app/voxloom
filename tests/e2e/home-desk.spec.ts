import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

for (const colorScheme of ['dark', 'light'] as const) {
  test(`Home keeps the transcript sheet beside the controls and stacks it at 640px (${colorScheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 1120, height: 760 });
    await page.goto('/');
    await page.getByRole('button', { name: 'Set up later' }).click();

    const sheet = page.locator('.home-paper');
    const voice = page.locator('.home-voice');
    const latest = sheet.getByRole('region', { name: 'Last dictation' });
    await expect(latest).toBeInViewport();
    await expect(sheet.getByRole('region', { name: 'Earlier dictations' })).toBeInViewport();
    const desktopVoice = (await voice.boundingBox())!;
    const desktopSheet = (await sheet.boundingBox())!;
    expect(desktopSheet.y).toBeCloseTo(desktopVoice.y);
    expect(desktopSheet.x).toBeGreaterThan(desktopVoice.x + desktopVoice.width);

    await page.getByRole('radio', { name: 'Formal', exact: true }).focus();
    await page.keyboard.press('Tab');
    const copy = latest.getByRole('button', { name: 'Copy last dictation' });
    await expect(copy).toBeFocused();
    await expect(copy).toHaveCSS('outline-style', 'solid');

    await page.setViewportSize({ width: 640, height: 760 });
    const narrowVoice = (await voice.boundingBox())!;
    const narrowSheet = (await sheet.boundingBox())!;
    expect(narrowSheet.x).toBeCloseTo(narrowVoice.x);
    expect(narrowSheet.y).toBeGreaterThan(narrowVoice.y + narrowVoice.height);
    expect(narrowSheet.x + narrowSheet.width).toBeLessThanOrEqual(640);
    await expect(latest).toBeInViewport();
    const axe = await new AxeBuilder({ page }).include('.home').analyze();
    expect(axe.violations).toEqual([]);
  });
}

test('the previous dictation stays readable during capture with reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Set up later' }).click();
  await page.getByText('Developer', { exact: true }).click();
  await page.getByRole('button', { name: 'Listening · speaking' }).click();

  const voice = page.locator('.home-voice');
  await expect(voice).toHaveAttribute('data-phase', 'speaking');
  await expect(voice.locator('.stage__mic')).toHaveText('Listening');
  const words = page.getByRole('region', { name: 'Last dictation' }).locator('blockquote p');
  await expect(words).toHaveCSS('opacity', '1');
  expect(await page.locator('.pick__weft').evaluate((el) => getComputedStyle(el, '::after').animationName)).toBe('none');
});
