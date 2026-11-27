import { expect, test } from '@playwright/test';
import { emit, levels, openOverlay } from '../fixtures/hudDriver';

test('Reduce Motion follows live preference changes without hiding the measured level or wait state', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openOverlay(page);
  const capsule = page.locator('.hud-capsule');
  const lastBar = page.locator('.wave i').last();
  await expect(lastBar).toHaveCSS('transition-property', 'transform');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(lastBar).toHaveCSS('transition-duration', '0s');
  await levels(page, [1]);
  expect((await lastBar.boundingBox())!.height).toBe(18);
  await emit(page, 'overlay:waveform', { waveform: 'processing' });
  await expect(capsule).toHaveText('Transcribing');
  expect(await capsule.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(page.locator('.hud-writing-line')).toHaveCSS('animation-name', 'hud-write');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.hud-writing-line')).toHaveCSS('animation-name', 'none');
  await emit(page, 'overlay:waveform', { waveform: 'result-copied', result: 'copied' });
  await expect(capsule).toContainText('Copied');
  expect(await capsule.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);
});

test('Reduce Motion does not introduce transitions on HUD document style changes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/overlay.html');
  const transitions = await page.evaluate(() => {
    const root = document.getElementById('root')!;
    root.style.color = 'rgb(255, 0, 0)';
    void getComputedStyle(root).color;
    root.style.color = 'rgb(0, 0, 255)';
    return root.getAnimations().map((a) => (a as CSSTransition).transitionProperty);
  });
  expect(transitions).toEqual([]);
});
