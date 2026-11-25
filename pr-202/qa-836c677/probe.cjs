// QA #202 @836c677: computed states + 2x crops for regular primaries, and Home parity vs 4cf8d32.
const { chromium } = require('/tmp/qa-202/node_modules/playwright');
const EXE = '/workspace/vx-ci-playwright/.playwright-browsers/chromium_headless_shell-1243/chrome-headless-shell-linux64/chrome-headless-shell';
const fs = require('fs');
const OUT = '/workspace/qa-ui/202/836c677/shots';
const S06 = 'qwen3-0.6b-q4-k-m';
const status = { available: true, id: S06, runtimeAvailable: true, sha256: 'x', models: [{ id: S06, available: true }] };
const NOW = Date.parse('2026-11-25T08:40:00-05:00');
const dict = JSON.stringify({ version: 1, words: ['JSON', 'Postgres', 'TanStack Query', 'TypeScript', 'Vite'] });
async function open(browser, port, theme, view, dsf, rm) {
  const page = await browser.newPage({ viewport: { width: 1120, height: 760 }, colorScheme: theme, deviceScaleFactor: dsf, reducedMotion: rm ? 'reduce' : 'no-preference' });
  await page.clock.setFixedTime(NOW);
  const file = JSON.stringify({ version: 2, onboardingComplete: view !== 'onboarding', settings: { appearance: theme, style: 'casual', cleanupEnabled: true, cleanupOptIn: true, cleanupModelId: S06 } });
  await page.exposeFunction('__inv', (cmd) => cmd === 'settings_load' ? file : cmd === 'dictionary_load' ? dict : cmd === 'cleanup_model_status' ? status : /list|devices/.test(cmd) ? [] : null);
  await page.addInitScript(() => {
    const w = window; let cb = 1; w.isTauri = true; w.__cbs = {};
    w.__TAURI_INTERNALS__ = { convertFileSrc: (p) => p, invoke: async (cmd, args) => { if (cmd === 'plugin:event|listen') { w.__cbs[args.event] = args.handler; return args.handler; } return w.__inv(cmd); },
      metadata: { currentWebview: { label: 'main', windowLabel: 'main' }, currentWindow: { label: 'main' } }, transformCallback: (f) => { const id = cb++; w['_' + id] = f; return id; }, unregisterCallback: () => {} };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  });
  await page.goto(`http://127.0.0.1:${port}/`); await page.waitForTimeout(1300);
  if (view === 'home-stop') await page.evaluate(() => {
    const card = document.querySelector('#capture-title').closest('section'); card.querySelector('.status.form-error')?.remove();
    card.querySelector('.dogfood-capture-actions').innerHTML = '<button class="btn primary big" type="button"><span aria-hidden="true" class="rec-dot"></span> Stop</button><button class="quiet-button" type="button">Cancel</button>';
    document.querySelectorAll('.rec-dot').forEach((d) => { d.style.animation = 'none'; d.style.opacity = '1'; });
  });
  if (view === 'home') await page.evaluate(() => document.querySelector('#capture-title').closest('section').querySelector('.status.form-error')?.remove());
  if (['dictionary', 'word', 'done'].includes(view)) { await page.getByRole('button', { name: /^Dictionary/ }).first().click(); await page.waitForTimeout(500); }
  if (view === 'word') { await page.getByRole('button', { name: /Add term/ }).click(); await page.waitForTimeout(500); }
  if (view === 'word-empty') {}
  if (view === 'done') { await page.locator('.tb-help').click(); await page.waitForTimeout(500); }
  await page.mouse.move(1118, 758); await page.waitForTimeout(300);
  return page;
}
const SEL = { dictionary: '.page-head .btn.primary, main button.btn.primary', word: 'form .btn.primary', done: '.sheet-acts .btn.primary', onboarding: '.guided-footer .btn.primary', home: '.btn.primary.big', 'home-stop': '.btn.primary.big' };
const props = ['backgroundImage', 'backgroundColor', 'boxShadow', 'transform', 'outlineStyle', 'outlineColor', 'outlineWidth', 'color', 'transitionDuration', 'transitionProperty', 'borderTopWidth', 'borderRadius', 'opacity', 'fontWeight', 'fontSize', 'height'];
const comp = (b, props) => { const c = getComputedStyle(b); const o = { text: b.textContent.trim(), disabled: b.disabled, matchesFV: b.matches(':focus-visible') }; for (const p of props) o[p] = c[p]; o.h = b.getBoundingClientRect().height; o.y = b.getBoundingClientRect().y; return o; };
(async () => {
  const MODE = process.argv[2];
  const browser = await chromium.launch({ executablePath: EXE });
  const res = {};
  if (MODE === 'states') {
    for (const rm of [false, true]) for (const theme of ['light', 'dark']) for (const view of ['dictionary', 'word', 'done', 'onboarding', 'home', 'home-stop']) {
      const p = await open(browser, 1631, theme, view, 2, rm);
      const btn = p.locator(SEL[view]).first();
      if (!(await btn.count())) { res[`${view}-${theme}-${rm}`] = 'MISSING'; await p.close(); continue; }
      if (view === 'word') await p.keyboard.type('Kubernetes');
      const r = await btn.boundingBox(); const clip = { x: Math.max(0, r.x - 28), y: Math.max(0, r.y - 22), width: r.width + 56, height: r.height + 46 };
      const k = `${view}-${theme}${rm ? '-rm' : ''}`; const st = {};
      const snap = async (name) => { await p.waitForTimeout(300); st[name] = await btn.evaluate(comp, props); if (!rm) await p.screenshot({ path: `${OUT}/${k}-${name}.png`, clip }); };
      await snap('rest');
      await btn.hover(); await snap('hover');
      await p.mouse.down(); await snap('active');
      await p.mouse.move(1118, 758); await p.mouse.up(); await p.waitForTimeout(200);
      if (view === 'word' || view === 'done' || view === 'onboarding') { await p.close(); const p2 = await open(browser, 1631, theme, view, 2, rm); if (view === 'word') await p2.keyboard.type('Kubernetes'); await fvPart(p2, p2.locator(SEL[view]).first(), clip, k, st, rm); await p2.close(); }
      else { await fvPart(p, btn, clip, k, st, rm); await p.close(); }
      res[k] = st;
    }
  }
  async function fvPart(p, btn, clip, k, st, rm) {
    const snap = async (name) => { await p.waitForTimeout(300); st[name] = await btn.evaluate(comp, props); if (!rm) await p.screenshot({ path: `${OUT}/${k}-${name}.png`, clip }); };
    // keyboard focus: Tab until the button is focused
    let ok = false; for (let i = 0; i < 40; i++) { await p.keyboard.press('Tab'); if (await btn.evaluate((b) => b === document.activeElement)) { ok = true; break; } }
    if (!ok) await btn.evaluate((b) => b.focus({ focusVisible: true }));
    st.focusVia = ok ? 'Tab' : 'focus()';
    await snap('focus');
    await btn.hover(); await snap('focus-hover');
    await p.mouse.down(); await snap('focus-active');
    await p.mouse.move(1118, 758); await p.waitForTimeout(100);
    await btn.evaluate((b) => { b.blur(); b.disabled = true; }); await p.mouse.up(); await snap('disabled');
    await btn.hover(); await snap('disabled-hover');
  }
  if (MODE === 'parity') {
    for (const port of [1631, 1632]) for (const theme of ['light', 'dark']) for (const view of ['home', 'home-stop', 'dictionary', 'word', 'done', 'onboarding']) {
      const p = await open(browser, port, theme, view, 1, false);
      await p.screenshot({ path: `${OUT}/page-${port === 1631 ? 'head' : 'base'}-${view}-${theme}.png` }); await p.close();
    }
  }
  if (MODE === 'fc') {
    for (const theme of ['light', 'dark']) { const p = await browser.newPage(); await p.close(); }
    for (const theme of ['light', 'dark']) for (const view of ['dictionary', 'word']) {
      const p = await open(browser, 1631, theme, view, 1, false); await p.emulateMedia({ forcedColors: 'active' });
      const btn = p.locator(SEL[view]).first(); if (view === 'word') await p.keyboard.type('X');
      await btn.evaluate((b) => b.focus({ focusVisible: true })); await p.waitForTimeout(200);
      res[`${view}-${theme}-fc-focus`] = await btn.evaluate(comp, props); await p.close();
    }
  }
  fs.writeFileSync(`/workspace/qa-ui/202/836c677/probe-${MODE}.json`, JSON.stringify(res, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
