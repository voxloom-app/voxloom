import { expect, test } from '@playwright/test';
import { emit, openOverlay } from '../fixtures/hudDriver';

// QA #44: measure the words themselves, not a possibly clipped flex box.
for (const [platform, paste] of [['MacIntel', '⌘V'], ['Linux x86_64', 'Ctrl+V']]) {
  test(`Every result clears the capsule ends even with a wider font (${platform})`, async ({ page }) => {
    await page.addInitScript(value => Object.defineProperty(navigator, 'platform', { value }), platform);
    await openOverlay(page);
    await page.setViewportSize({ height: 40, width: 248 });
    await page.addStyleTag({ content: ':root, html, body { --font: Verdana, sans-serif !important; }' });
    for (const [waveform, result, text] of [
      ['result-copied', 'copied', `Copied · ${paste} to paste`],
      ['result-unverified', 'maybe-copied', 'Maybe inserted · copied'],
      ['result-failed', 'insert-failed', 'Couldn’t insert'],
      ['result-failed', 'transcribe-failed', 'Couldn’t transcribe'],
    ]) {
      await emit(page, 'overlay:waveform', { waveform, result });
      const label = page.locator('.hud-label');
      await expect(label).toHaveText(text);
      await expect(label).toHaveCSS('font-family', 'Verdana, sans-serif');
      await expect(label).toHaveCSS('transform', 'none');
      const fit = await label.evaluate(node => {
        const range = document.createRange();
        range.selectNodeContents(node);
        const words = range.getBoundingClientRect();
        const tag = node.parentElement!.getBoundingClientRect();
        return { left: tag.left, right: tag.right, top: tag.top, bottom: tag.bottom,
          leftInset: words.left - tag.left, rightInset: tag.right - words.right };
      });
      expect(fit.left).toBeGreaterThanOrEqual(4);
      expect(fit.right).toBeLessThanOrEqual(244);
      expect(fit.top).toBeGreaterThanOrEqual(0);
      expect(fit.bottom).toBeLessThanOrEqual(40);
      expect(fit.leftInset).toBeGreaterThanOrEqual(20);
      expect(fit.rightInset).toBeGreaterThanOrEqual(20);
    }
  });
}
