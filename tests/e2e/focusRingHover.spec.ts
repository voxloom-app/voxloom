import { expect, test, type Locator, type Page } from '@playwright/test';

// QA finding (4/10): hovering Start/Stop removed the keyboard-focus ring.
// hover/active selectors must not replace the :focus-visible ring shadow —
// verify combined focus+hover and focus+active keep the 2px gap + 5px accent ring,
// in both light and dark themes.
//
// CSS-only test (same approach as hud.spec.ts): the app is removed and just the
// button is injected under the app's global stylesheets, so no
// native capture, onboarding trap, or React state is involved.
const RING_LAYERS = ['0px 0px 0px 2px', '0px 0px 0px 5px'];

async function keyboardFocusedButton(
  page: Page,
  theme: 'light' | 'dark',
  className: string,
): Promise<Locator> {
  await page.goto('/');
  await page.evaluate(([t, c]) => {
    document.getElementById('root')?.remove();
    document.body.setAttribute('data-appearance-resolved', t);
    const host = document.createElement('div');
    host.className = 'home';
    host.innerHTML = `<button class="${c}" type="button">Start capture</button>`;
    document.body.append(host);
  }, [theme, className] as const);

  // The injected button is the only focusable element, so one Tab gives it keyboard focus.
  const btn = page.locator(`button.${className.trim().split(/\s+/).join('.')}`);
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

async function assertRingPersists(page: Page, theme: 'light' | 'dark', className: string) {
  const btn = await keyboardFocusedButton(page, theme, className);

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
}

for (const theme of ['light', 'dark'] as const) {
  test(`Start/Stop keeps its focus ring while hovered and pressed (${theme})`, async ({ page }) => {
    await assertRingPersists(page, theme, 'btn primary big');
  });

  test(`regular primary keeps its focus ring while hovered and pressed (${theme})`, async ({ page }) => {
    await assertRingPersists(page, theme, 'btn primary');
  });
}

async function inject(page: Page, theme: 'light' | 'dark', html: string) {
  await page.goto('/');
  await page.evaluate(([t, markup]) => {
    document.getElementById('root')?.remove();
    document.body.setAttribute('data-appearance-resolved', t);
    const host = document.createElement('div');
    host.className = 'home';
    host.innerHTML = markup;
    document.body.append(host);
  }, [theme, html] as const);
}

function styleOf(page: Page, selector: string, disabled = false) {
  return page.locator(selector).evaluate((b, isDisabled) => {
    if (isDisabled) (b as HTMLButtonElement).disabled = true;
    const s = getComputedStyle(b);
    return {
      boxShadow: s.boxShadow,
      backgroundImage: s.backgroundImage,
      backgroundColor: s.backgroundColor,
      minHeight: s.minHeight,
      padding: s.padding,
      borderTopWidth: s.borderTopWidth,
    };
  }, disabled);
}

for (const theme of ['light', 'dark'] as const) {
  test(`disabled primary stays flat and secondary/ghost have no gradient (${theme})`, async ({ page }) => {
    await page.goto('/');
    await page.evaluate((t) => {
      document.getElementById('root')?.remove();
      document.body.setAttribute('data-appearance-resolved', t);
      // Keep secondary/ghost outside .home so Home's own secondary wash is not in scope.
      document.body.insertAdjacentHTML('beforeend', [
        '<button class="btn primary" type="button" disabled>Add term</button>',
        '<button class="btn primary big" type="button" disabled>Start capture</button>',
        '<button class="btn" type="button">Cancel</button>',
        '<button class="btn ghost" type="button">Set up later</button>',
      ].join(''));
    }, theme);

    for (const selector of ['button.btn.primary:not(.big)', 'button.btn.primary.big']) {
      const disabled = await page.locator(selector).evaluate((b, token) => {
        const s = getComputedStyle(b);
        const probe = document.createElement('div');
        probe.style.background = token;
        document.body.append(probe);
        const expected = getComputedStyle(probe).backgroundColor;
        probe.remove();
        return {
          isDisabled: (b as HTMLButtonElement).disabled,
          boxShadow: s.boxShadow,
          backgroundImage: s.backgroundImage,
          backgroundColor: s.backgroundColor,
          expected,
        };
      }, 'var(--seg)');
      expect(disabled.isDisabled, selector).toBe(true);
      expect(disabled.boxShadow, selector).toBe('none');
      expect(disabled.backgroundImage, selector).toBe('none');
      expect(disabled.backgroundColor, selector).toBe(disabled.expected);
    }

    for (const selector of ['button.btn:not(.primary):not(.ghost)', 'button.btn.ghost']) {
      const style = await styleOf(page, selector);
      expect(style.backgroundImage, selector).not.toMatch(/gradient/i);
    }
  });

  test(`Start/Stop .btn.primary.big computed styles stay the layered big treatment (${theme})`, async ({ page }) => {
    await inject(page, theme, '<button class="btn primary big" type="button">Start capture</button>');
    const rest = await styleOf(page, 'button.btn.primary.big');
    expect(rest.minHeight).toBe('42px');
    expect(rest.padding).toBe('9px 18px');
    expect(rest.borderTopWidth).toBe('1px');
    expect(rest.backgroundImage).toMatch(/linear-gradient/);
    // Distinctive Start/Stop outer shadow (not the regular 8px/16px scale). Start always sits on
    // the dark voice stage (ui-iter-01), so both themes use the tight, attached dark shadow.
    expect(rest.boxShadow).toContain('0px 1px 0px');
    expect(rest.boxShadow).toContain('2px 4px -1px');
    expect(rest.boxShadow).toContain('6px 18px -6px');
    expect(rest.boxShadow).not.toContain('12px 24px -10px');
    expect(rest.boxShadow).not.toContain('8px 16px -8px');
  });
}
