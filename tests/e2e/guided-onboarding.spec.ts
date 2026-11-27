import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { join } from 'node:path';
import process from 'node:process';

for (const theme of ['dark', 'light']) for (const width of [640, 1000, 1440]) {
  test(`${theme} B spine and controls fit ${width}x620 with reduced motion`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 620 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const step of [0, 1, 2, 3, 4]) {
      await page.goto(`/tests/fixtures/guided-preview.html?step=${step}&theme=${theme}`);
      const panel = page.getByRole('main', { name: 'Set up Voxloom' });
      await expect(page.getByRole('heading', { level: 2 })).toBeFocused();
      const rect = await panel.boundingBox();
      const filename = `guided-${theme}-${width}-step${step}-${process.env.VISUAL_PHASE ?? 'green'}.png`;
      await page.screenshot({ path: process.env.GUIDED_EVIDENCE_DIR ? join(process.env.GUIDED_EVIDENCE_DIR, filename) : testInfo.outputPath(filename) });
      // BUS-216: setup fills the whole window; no dialog or backdrop.
      expect(rect).toEqual({ x: 0, y: 0, width, height: 620 });
      await expect(page.getByRole('dialog')).toHaveCount(0);
      const footer = await page.locator('.guided-footer').boundingBox();
      expect(footer!.y + footer!.height).toBeLessThanOrEqual(620);
      if (step === 0) {
        const disclosure = await page.getByText(/Starting setup downloads Whisper Base/).boundingBox();
        expect(disclosure!.y + disclosure!.height).toBeLessThanOrEqual(footer!.y);
        // BUS-220: all three welcome rows fit without scrolling the content pane.
        const content = page.locator('.guided-content');
        expect(await content.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
        const pane = await content.boundingBox();
        const rows = page.getByRole('list', { name: 'Setup steps' }).getByRole('listitem');
        await expect(rows).toHaveCount(3);
        for (const row of await rows.all()) {
          const box = await row.boundingBox();
          expect(box!.y + box!.height).toBeLessThanOrEqual(pane!.y + pane!.height);
        }
        // Under 760px the download note lines up with the content edge (22px).
        if (width < 760) expect(await page.locator('.guided-disclosure').evaluate((el) => getComputedStyle(el).paddingLeft)).toBe('22px');
      }
      if (step === 3) await expect(page.getByRole('status')).toHaveText('Ready when you are');
      expect(await page.locator('.guided-setup').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
      const violations = (await new AxeBuilder({ page }).include('.setup-window').analyze()).violations;
      expect(violations).toEqual([]);
      await page.keyboard.press('Shift+Tab');
      expect(await panel.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    }
  });
}

for (const theme of ['dark', 'light']) {
  test(`${theme} Get connected fits the minimum window with outstanding and completed checks`, async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 620 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const preview = `/tests/fixtures/guided-preview.html?step=1&theme=${theme}`;
    const cases = [
      ['&mic=off&access=off&ready=0', 'Allow microphone access.'],
      ['&mic=denied&access=off&ready=0', 'Allow microphone access.'],
      ['&access=off&pack=downloading', 'Turn on Accessibility.'],
      ['&ready=0', 'Get your voice pack.'],
      ['&pack=downloading', 'Downloading your voice pack.'],
      ['&pack=failed', 'Retry the download.'],
      ['', 'You’re connected.'],
    ];
    for (const [query, title] of cases) {
      await page.goto(preview + query);
      await page.addStyleTag({ content: ':root, html, body { --font: Verdana, sans-serif !important; }' });
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeFocused();
      const content = page.locator('.guided-content');
      expect(await content.evaluate(el => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth)).toBe(true);
      await expect(page.getByRole('list', { name: 'Connection checks' }).getByRole('listitem')).toHaveCount(3);
      await expect(page.locator('.guided-footer button')).toHaveText(['Back', 'Set up later', 'Continue →']);
      if (query) await expect(page.getByRole('button', { name: 'Continue →' })).toBeDisabled();
      else await expect(page.getByRole('button', { name: 'Continue →' })).toBeEnabled();
      expect((await new AxeBuilder({ page }).include('.setup-window').analyze()).violations).toEqual([]);
    }
    // The same three confirmations sit beside (not below) the instruction in a large window.
    await page.setViewportSize({ width: 1468, height: 888 });
    const task = await page.getByRole('heading', { name: 'You’re connected.' }).boundingBox();
    const receipt = await page.getByRole('heading', { name: 'Connection checks' }).boundingBox();
    expect(receipt!.x).toBeGreaterThan(task!.x + task!.width);
  });
}

// ui-iter-37: Your shortcut and First words show the user's own keys, glyphs on macOS and
// words elsewhere, and fit the minimum window in the wider Linux font.
for (const theme of ['dark', 'light']) for (const platform of ['MacIntel', 'Linux x86_64']) {
  test(`${theme} Your shortcut and First words fit 640x620 with ${platform} keys`, async ({ page }) => {
    await page.addInitScript((name) => Object.defineProperty(Navigator.prototype, 'platform', { get: () => name }), platform);
    await page.setViewportSize({ width: 640, height: 620 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const mac = platform === 'MacIntel';
    const cases: [string, RegExp, string[]][] = [
      ['step=2', /^Your shortcut/, mac ? ['⌃', '⇧', 'Space'] : ['Ctrl', 'Shift', 'Space']],
      ['step=2&shortcut=AltRight', /^Your shortcut/, mac ? ['⌥'] : ['Alt']],
      ['step=2&shortcut=Ctrl+Alt+PageDown', /^Your shortcut/, mac ? ['⌃', '⌥', 'PageDown'] : ['Ctrl', 'Alt', 'PageDown']],
      ['step=3', /^First, hold to talk/, mac ? ['⌃', '⇧', 'Space'] : ['Ctrl', 'Shift', 'Space']],
      ['step=3&shortcut=Ctrl+Alt+PageDown', /^First, hold to talk/, mac ? ['⌃', '⌥', 'PageDown'] : ['Ctrl', 'Alt', 'PageDown']],
      ['step=3&practice=holddone', /^That’s hold to talk/, []],
      ['step=3&practice=tap', /^Now, go hands-free/, []],
      ['step=3&practice=both', /^Both ways/, []],
      ['step=3&access=off', /^First, hold to talk/, []],
    ];
    for (const [query, title, keys] of cases) {
      await page.goto(`/tests/fixtures/guided-preview.html?theme=${theme}&${query}`);
      await page.addStyleTag({ content: ':root, html, body { --font: Verdana, sans-serif !important; }' });
      await expect(page.getByRole('heading', { level: 2, name: title })).toBeFocused();
      const caps = page.locator(query.startsWith('step=2') ? '.shortcut-card__keys .kbd' : '.practice__beats .kbd');
      if (keys.length) await expect(caps).toHaveText(keys);
      const content = page.locator('.guided-content');
      expect(await content.evaluate((el) => el.scrollHeight <= el.clientHeight && el.scrollWidth <= el.clientWidth), query).toBe(true);
      // A waiting primary says why beside it; an open one has nothing to explain.
      const primary = page.locator('.guided-footer .btn.primary');
      if (await primary.isDisabled()) await expect(primary).toHaveAccessibleDescription(/\S/);
      else await expect(primary).not.toHaveAttribute('aria-describedby');
      expect((await new AxeBuilder({ page }).include('.setup-window').analyze()).violations).toEqual([]);
    }
  });
}
for (const theme of ['dark', 'light']) {
  test(`${theme} Your shortcut and First words use a large window as two columns`, async ({ page }) => {
    await page.setViewportSize({ width: 1468, height: 888 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/tests/fixtures/guided-preview.html?theme=${theme}&step=2`);
    const card = await page.getByRole('group', { name: /^Your shortcut/ }).boundingBox();
    const ways = await page.getByRole('region', { name: 'Two ways to use it' }).boundingBox();
    expect(ways!.x).toBeGreaterThan(card!.x + card!.width);
    await page.goto(`/tests/fixtures/guided-preview.html?theme=${theme}&step=3`);
    const beats = await page.locator('.practice__beats').boundingBox();
    const note = await page.getByRole('textbox', { name: 'Practice dictation field' }).boundingBox();
    expect(note!.x).toBeGreaterThan(beats!.x + beats!.width);
    await expect(page.getByRole('status')).toHaveText('Ready when you are');
  });
}

// BUS-224/BUS-225: Welcome with the voice pack not downloaded yet, and the finish step ready and not ready.
const shot = async (page: import('@playwright/test').Page, testInfo: import('@playwright/test').TestInfo, filename: string) =>
  page.screenshot({ path: process.env.GUIDED_EVIDENCE_DIR ? join(process.env.GUIDED_EVIDENCE_DIR, filename) : testInfo.outputPath(filename) });
for (const theme of ['dark', 'light']) {
  test(`${theme} welcome shows no voice-pack error before setup starts and no Skip setup`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 640, height: 620 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/tests/fixtures/guided-preview.html?step=0&theme=${theme}&ready=0`);
    await expect(page.getByRole('heading', { level: 2 })).toBeFocused();
    await expect(page.getByRole('button', { name: /Start setup/ })).toBeEnabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.guided-footer').getByRole('button')).toHaveText(['Set up later', 'Start setup →']);
    await shot(page, testInfo, `bus224-${theme}-640x620-step0-not-ready.png`);
  });
  test(`${theme} finish step with the voice pack missing shows one in-place alert without scrolling at 640x620`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 640, height: 620 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`/tests/fixtures/guided-preview.html?step=4&theme=${theme}&ready=0`);
    await expect(page.getByRole('heading', { level: 2 })).toBeFocused();
    const alert = page.getByRole('alert');
    await expect(alert).toHaveText(/voice pack is missing/);
    await expect(alert).toHaveCount(1);
    await expect(page.getByText('Access or the voice pack needs attention before you finish.')).toHaveCount(0);
    await expect(page.locator('.guided-footer').getByRole('button')).toHaveText(['Back', 'Open Voxloom']);
    expect(await page.locator('.guided-content').evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
    const violations = (await new AxeBuilder({ page }).include('.setup-window').analyze()).violations;
    expect(violations).toEqual([]);
    await shot(page, testInfo, `bus225-${theme}-640x620-step4-pack-missing.png`);
  });
  for (const [width, height] of [[1120, 760], [640, 620]]) for (const ready of [true, false]) {
    test(`${theme} finish step fits ${width}x${height} ${ready ? 'ready' : 'not ready'}`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(`/tests/fixtures/guided-preview.html?step=4&theme=${theme}${ready ? '' : '&access=off'}`);
      await expect(page.getByRole('heading', { level: 2 })).toBeFocused();
      const open = page.getByRole('button', { name: 'Open Voxloom' });
      if (ready) await expect(open).toBeEnabled();
      else await expect(page.getByRole('alert')).toHaveText('Access or the voice pack needs attention before you finish.');
      await expect(page.locator('.guided-footer').getByRole('button')).toHaveText(['Back', 'Open Voxloom']);
      expect(await page.locator('.guided-content').evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
      const footer = await page.locator('.guided-footer').boundingBox();
      expect(footer!.y + footer!.height).toBeLessThanOrEqual(height);
      const violations = (await new AxeBuilder({ page }).include('.setup-window').analyze()).violations;
      expect(violations).toEqual([]);
      await shot(page, testInfo, `bus225-${theme}-${width}x${height}-step4-${ready ? 'ready' : 'not-ready'}.png`);
    });
  }
}
