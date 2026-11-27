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
  await expect(capsule.locator('.hud-caption')).toHaveText('Transcribing');
  const ink = page.locator('[data-form="ink"] i');
  const first = (await ink.first().boundingBox())!;
  const last = (await ink.last().boundingBox())!;
  expect(last.y).toBeGreaterThan(first.y + first.height);
  expect(last.width).toBeGreaterThan(first.width); // the printed peak is still visible
  expect(await capsule.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(ink.first()).toHaveCSS('animation-name', 'hud-ink');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(ink.first()).toHaveCSS('animation-name', 'none');
  await emit(page, 'overlay:waveform', { waveform: 'result-copied', result: 'copied' });
  await expect(capsule).toContainText('Copied');
  expect(await capsule.evaluate(el => el.getAnimations({ subtree: true }).length)).toBe(0);
});

test('The processing stub measures elapsed wait without advancing or repeating the announcement', async ({ page }) => {
  await page.clock.install();
  await openOverlay(page);
  await emit(page, 'overlay:waveform', { waveform: 'processing' });
  const clock = page.locator('.hud-clock');
  await expect(clock).toHaveText('0:00');
  await expect(clock).toHaveAttribute('aria-hidden', 'true');
  await page.clock.fastForward(10_000);
  await expect(clock).toHaveText('0:10');
  await emit(page, 'overlay:waveform', { waveform: 'processing' });
  await page.clock.fastForward(50_000);
  await expect(clock).toHaveText('1:00');
  await expect(page.getByRole('status')).toHaveText('Transcribing');
  await emit(page, 'overlay:waveform', { waveform: 'silent' });
  await expect(clock).toHaveCount(0);
  await emit(page, 'overlay:waveform', { waveform: 'processing' });
  await expect(clock).toHaveText('0:00');
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
