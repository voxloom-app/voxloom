import { chromium } from '/tmp/vx-pasted/node_modules/playwright/index.mjs';
const [url, tag, out] = process.argv.slice(2);
const browser = await chromium.launch();
for (const scale of [1, 2]) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: scale });
  const page = await ctx.newPage();
  await page.goto(url);
  await page.getByRole('button', { name: 'Set up later' }).click();
  for (const theme of ['Light', 'Dark']) {
    await page.getByRole('button', { name: 'Settings' }).click();
    await page.getByRole('tab', { name: 'Appearance' }).click();
    await page.getByLabel(theme).check();
    await page.getByRole('button', { name: 'History', exact: true }).first().click();
    await page.locator('.history-row').first().waitFor();
    // Fixed timestamps so before/after differ only by the badge.
    await page.locator('.history-row .timestamp').evaluateAll((els) => els.forEach((el, i) => { el.textContent = ['4:18 PM','4:12 PM','3:37 PM','3:13 PM','2:50 PM','2:29 PM'][i] ?? el.textContent; }));
    const slug = theme.toLowerCase();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: `${out}/${tag}-history-${slug}-${scale}x.png`, fullPage: true });
    const rows = page.locator('.history-list');
    await rows.screenshot({ path: `${out}/${tag}-rows-${slug}-${scale}x.png` });
  }
  await ctx.close();
}
await browser.close();
