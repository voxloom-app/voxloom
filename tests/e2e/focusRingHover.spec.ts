import { expect, test, type Locator, type Page } from '@playwright/test';

// QA finding (4/10): hovering Start/Stop removed the keyboard-focus ring.
// hover/active selectors must not replace the :focus-visible ring shadow —
// verify combined focus+hover and focus+active keep the 2px gap + 5px accent ring,
// in both light and dark themes.
//
// CSS-only test (same approach as hud.spec.ts): the app is removed and just the
// .btn.primary.big control is injected under the app's global stylesheets, so no
// native capture, onboarding trap, or React state is involved.
const RING_LAYERS = ['0px 0px 0px 2px', '0px 0px 0px 5px'];

async function keyboardFocusedButton(page: Page, theme: 'light' | 'dark'): Promise<Locator> {
  await page.goto('/');
  await page.evaluate((t) => {
    document.getElementById('root')?.remove();
    document.body.setAttribute('data-appearance-resolved', t);
    const host = document.createElement('div');
    host.className = 'home';
    host.innerHTML = '<button class="btn primary big" type="button">Start capture</button>';
    document.body.append(host);
  }, theme);

  // The injected button is the only focusable element, so one Tab gives it keyboard focus.
  const btn = page.locator('button.btn.primary.big');
  await page.keyboard.press('Tab');
  await expect(btn).toBeFocused();
  expect(await btn.evaluate((b) => b.matches(':focus-visible'))).toBe(true);
  return btn;
}

async function ringPresent(btn: Locator): Promise<boolean> {
  return btn.evaluate((b, layers) => {
    const shadow = getComputedStyle(b).boxShadow;
    return layers.every((layer) => shadow.includes(layer));
  }, RING_LAYERS);
}

for (const theme of ['light', 'dark'] as const) {
  test(`Start/Stop keeps its focus ring while hovered and pressed (${theme})`, async ({ page }) => {
    const btn = await keyboardFocusedButton(page, theme);

    // Baseline: ring present under plain keyboard focus.
    await expect.poll(() => ringPresent(btn), { timeout: 5000 }).toBe(true);

    // Focus + hover must keep the ring.
    await btn.hover();
    await expect.poll(() => ringPresent(btn), { timeout: 5000 }).toBe(true);

    // Focus + active must keep the ring. Use a real press: synthetic mousedown events don't set :active.
    await page.mouse.down();
    await expect.poll(() => btn.evaluate((b) => b.matches(':active')), { timeout: 5000 }).toBe(true);
    await expect.poll(() => ringPresent(btn), { timeout: 5000 }).toBe(true);
    await page.mouse.up();
  });
}
