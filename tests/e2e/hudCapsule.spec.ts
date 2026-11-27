import { expect, test } from '@playwright/test';
import { emit, levels, openOverlay } from '../fixtures/hudDriver';

for (const platform of ['MacIntel', 'Linux x86_64']) {
  test(`Live meter, transcription and results share a face without stealing focus (${platform})`, async ({ page }) => {
    const modifier = platform === 'MacIntel' ? 'Command' : 'Control';
    await page.addInitScript(value => Object.defineProperty(navigator, 'platform', { value }), platform);
    await openOverlay(page);
    await page.addStyleTag({ content: ':root, html, body { --font: Verdana, sans-serif !important; }' });
    const status = page.getByRole('status');
    const capsule = page.locator('.hud-capsule');
    const signal = page.locator('.hud-signal');
    const interactive = page.locator('button, a, input, [tabindex]');
    await expect(status).toHaveText('');
    await expect(interactive).toHaveCount(0);
    await expect(signal).toHaveAttribute('aria-hidden', 'true');
    await expect(capsule).toHaveCSS('pointer-events', 'none');
    for (const element of [page.locator('html'), page.locator('body')]) {
      await expect(element).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    }
    const box = await capsule.boundingBox();
    expect(box).toEqual({ x: 24, y: 24, width: 142, height: 28 });
    for (const loc of [capsule, signal, status]) await loc.evaluate(node => node.setAttribute('data-original', 'true'));
    const bars = page.getByRole('img', { name: 'Microphone level' }).locator('i');
    expect((await bars.last().boundingBox())!.height).toBeCloseTo(3);
    await emit(page, 'overlay:waveform', { waveform: 'speaking' });
    await levels(page, [1]);
    // Only the new sample responds, not a canned oscillation or a mean across all bars.
    await expect.poll(async () => (await bars.last().boundingBox())!.height).toBe(18);
    expect((await bars.first().boundingBox())!.height).toBeCloseTo(3);
    await levels(page, [0], 0); // stale generation
    expect((await bars.last().boundingBox())!.height).toBe(18);
    await bars.last().evaluate(node => node.setAttribute('data-live-edge', 'true'));
    await emit(page, 'overlay:waveform', { waveform: 'processing' });
    await expect(status).toHaveText('Transcribing');
    await expect.poll(async () => (await capsule.boundingBox())?.width).toBe(168);
    const ink = capsule.locator('[data-form="ink"] i');
    await expect(ink.last()).toHaveAttribute('data-live-edge', 'true');
    const imprint = await ink.last().getAttribute('style');
    await levels(page, [1, 0]); // late levels neither rewrite the slip nor wake the mic
    await expect(ink.last()).toHaveAttribute('style', imprint!);
    await expect(bars).toHaveCount(0);
    await expect(capsule.locator('.hud-caption')).toHaveText('Transcribing');
    await expect(interactive).toHaveCount(0);
    await expect(signal.locator('[data-icon="edit"]')).toBeVisible();
    await page.setViewportSize({ width: 248, height: 40 });
    for (const [waveform, result, spoken] of [
      ['result-copied', 'copied', `Copied. Press ${modifier} V to paste`],
      ['result-unverified', 'maybe-copied', `May have been inserted; also copied. If it's missing, press ${modifier} V to paste.`],
      ['result-failed', 'insert-failed', 'Couldn’t insert'],
      ['result-failed', 'transcribe-failed', 'Couldn’t transcribe'],
    ]) {
      await emit(page, 'overlay:waveform', { waveform, result });
      await expect(status).toHaveText(spoken);
      await expect(bars).toHaveCount(0);
      await expect(capsule.locator('[data-form="knot"] i').last()).toHaveAttribute('data-live-edge', 'true');
      await expect(capsule.locator('[data-form="knot"] i').last()).toHaveCSS('opacity', '0');
      await expect(interactive).toHaveCount(0);
      for (const loc of [capsule, signal, status]) await expect(loc).toHaveAttribute('data-original', 'true');
      const tag = await capsule.boundingBox();
      const label = page.locator('.hud-label');
      await expect(label).toHaveCSS('transform', 'none');
      const words = await label.evaluate(node => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getBoundingClientRect().toJSON() as DOMRect;
      });
      expect(words.left).toBeGreaterThanOrEqual(tag!.x + 20);
      expect(words.right).toBeLessThanOrEqual(tag!.x + tag!.width - 20);
    }
    await page.setViewportSize({ width: 190, height: 76 });
    await emit(page, 'overlay:waveform', { waveform: 'silent' });
    await expect(status).toHaveText('');
    await expect.poll(async () => (await bars.last().boundingBox())!.height).toBeCloseTo(3);
  });
}
