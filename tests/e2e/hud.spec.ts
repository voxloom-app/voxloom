import { expect, test } from '@playwright/test';

// QA #44: every result fits the 248×40 result window (OVERLAY_RESULT_WIDTH) without clipping.
// ui-iter-06: the result is a shuttle-shaped tag on a thread, so the words must clear its tips.
const texts = [
  'Copied · ⌘V to paste', // Mac
  'Copied · Ctrl+V to paste', // Windows / Linux
  'Maybe inserted · copied',
  'Couldn’t transcribe',
  'Couldn’t insert',
];

test('HUD result tags fit the 248px result window', async ({ page }) => {
  await page.setViewportSize({ height: 40, width: 248 });
  await page.goto('/overlay.html');
  for (const text of texts) {
    const fit = await page.evaluate((t) => {
      const root = document.getElementById('root')!;
      root.innerHTML = '<div class="hud-result hud-result--unverified"><span class="hud-result__lead"></span>'
        + '<span class="hud-result__tag"><svg class="hud-result__knot" width="14" height="14"></svg>'
        + `<span class="hud-result__text">${t}</span></span><span class="hud-result__lead hud-result__lead--out"></span></div>`;
      const box = (selector: string) => root.querySelector(selector)!.getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(root.querySelector('.hud-result__text')!);
      const words = range.getBoundingClientRect();
      return { leads: [...root.querySelectorAll('.hud-result__lead')].map((lead) => lead.getBoundingClientRect().width),
        result: box('.hud-result').toJSON() as DOMRect, tag: box('.hud-result__tag').toJSON() as DOMRect,
        words: { left: words.left, right: words.right } };
    }, text);
    expect(fit.result.left, text).toBeGreaterThanOrEqual(4);
    expect(fit.result.right, text).toBeLessThanOrEqual(248 - 4);
    expect(fit.tag.width, text).toBeLessThanOrEqual(248 - 8);
    // Both thread leads stay visible, and the words never reach the tag's pointed tips.
    for (const lead of fit.leads) expect(lead, text).toBeGreaterThanOrEqual(8);
    expect(fit.words.left, text).toBeGreaterThanOrEqual(fit.tag.left + 20);
    expect(fit.words.right, text).toBeLessThanOrEqual(fit.tag.right - 20);
  }
});
