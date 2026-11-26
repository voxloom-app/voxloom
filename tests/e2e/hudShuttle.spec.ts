import { expect, test, type Page } from '@playwright/test';

// Exercise OverlayApp/OverlayWaveformView through their existing event boundary.
// No microphone, native window, replacement React root or decorative test markup.
async function openOverlay(page: Page) {
  await page.setViewportSize({ width: 190, height: 76 });
  await page.addInitScript(() => {
    const callbacks = new Map<number, (event: unknown) => void>();
    const listeners = new Map<number, string>();
    let nextId = 1;
    const w = window as unknown as {
      __TAURI_INTERNALS__: unknown;
      __TAURI_EVENT_PLUGIN_INTERNALS__: unknown;
      __hudTest: {
        ready: () => boolean;
        emit: (name: string, payload: unknown) => void;
      };
    };
    w.__TAURI_INTERNALS__ = {
      transformCallback: (callback: (event: unknown) => void) => {
        const id = nextId++;
        callbacks.set(id, callback);
        return id;
      },
      unregisterCallback: (id: number) => callbacks.delete(id),
      invoke: async (command: string, args: { event: string; handler: number; eventId: number }) => {
        if (command === 'plugin:event|listen') {
          listeners.set(args.handler, args.event);
          return args.handler;
        }
        if (command === 'plugin:event|unlisten') listeners.delete(args.eventId);
      },
    };
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
      unregisterListener: (_event: string, id: number) => listeners.delete(id),
    };
    w.__hudTest = {
      ready: () => ['overlay:waveform', 'capture:event'].every((name) => [...listeners.values()].includes(name)),
      emit: (name, payload) => {
        listeners.forEach((event, id) => {
          if (event === name) callbacks.get(id)?.({ event: name, id, payload });
        });
      },
    };
  });
  await page.goto('/overlay.html');
  await page.waitForFunction(() => (window as unknown as { __hudTest: { ready: () => boolean } }).__hudTest.ready());
}

async function emit(page: Page, name: string, payload: Record<string, unknown>) {
  await page.evaluate(({ name, payload }) => {
    (window as unknown as { __hudTest: { emit: (name: string, payload: unknown) => void } }).__hudTest.emit(name, payload);
  }, { name, payload });
}

async function fillLevels(page: Page, level: number) {
  for (let i = 0; i < 24; i++) {
    await emit(page, 'capture:event', { generation: 1, kind: 'capture-level', level, request_id: 'shuttle-test' });
  }
}

/** Vertical spread of the braid, in px (the meter's viewBox is the shuttle's 142×28). */
async function braidHeight(page: Page) {
  return page.locator('.wave').evaluate((svg) => {
    const boxes = [...svg.querySelectorAll<SVGGraphicsElement>('.wave__strand')].map((path) => path.getBBox());
    return Math.max(...boxes.map((box) => box.y + box.height)) - Math.min(...boxes.map((box) => box.y));
  });
}

test('The shuttle has a flowing rim and reactive halo, and your voice swells the braid inside it', async ({ page }, testInfo) => {
  await openOverlay(page);
  const shuttle = page.locator('.hud-shuttle');
  await expect(shuttle).toHaveAttribute('aria-hidden', 'true');
  await expect(shuttle).toHaveCSS('pointer-events', 'none');
  await expect(page.getByRole('status')).toHaveText('');
  const meter = page.getByRole('img', { name: 'Microphone level' });
  for (const strand of [0, 1, 2]) await expect(meter.locator(`.wave__strand--${strand}`).first()).toBeVisible();
  await expect(page.locator('button, input, [tabindex]')).toHaveCount(0);
  const body = page.locator('.recording--overlay');
  await expect(body).toHaveCSS('width', '142px');
  await expect(body).toHaveCSS('height', '28px');
  await expect(body).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)'); // The hull is the masked shuttle, not a box.
  const flow = shuttle.locator('.hud-shuttle__rim .hud-shuttle__flow');
  await expect(flow).toHaveCSS('animation-name', 'hud-shuttle-flow');
  const before = await flow.evaluate((node) => getComputedStyle(node).transform);
  await expect.poll(() => flow.evaluate((node) => getComputedStyle(node).transform)).not.toBe(before);
  const haloOpacity = async () => Number(await shuttle.locator('.hud-shuttle__halo').evaluate((node) => getComputedStyle(node).opacity));
  const quietOpacity = await haloOpacity();
  const quietBraid = await braidHeight(page);
  expect(quietBraid).toBeLessThan(4); // At rest it is one taut, twisted thread.
  await page.screenshot({ path: testInfo.outputPath('shuttle-silent.png'), omitBackground: true });
  await emit(page, 'overlay:waveform', { waveform: 'speaking' });
  await fillLevels(page, 1);
  await expect(shuttle).toHaveCSS('--shuttle-energy', '1');
  await expect.poll(haloOpacity).toBeGreaterThan(quietOpacity);
  expect(await braidHeight(page)).toBeGreaterThan(14);
  // The thread leaves both eyelets, and the hull stays clear of the window edge for the halo.
  for (const eye of ['in', 'out']) await expect(shuttle.locator(`.hud-shuttle__eye--${eye}`)).toBeVisible();
  const rimBox = await shuttle.locator('.hud-shuttle__rim').boundingBox();
  expect(rimBox!.x).toBeGreaterThanOrEqual(24);
  expect(rimBox!.y).toBeGreaterThanOrEqual(24);
  expect(rimBox!.x + rimBox!.width).toBeLessThanOrEqual(190 - 24);
  expect(rimBox!.y + rimBox!.height).toBeLessThanOrEqual(76 - 24);
  const braidBox = await meter.locator('.wave__front').boundingBox();
  expect(braidBox!.y).toBeGreaterThanOrEqual(rimBox!.y);
  expect(braidBox!.y + braidBox!.height).toBeLessThanOrEqual(rimBox!.y + rimBox!.height);
  const weftBox = await shuttle.locator('.hud-shuttle__weft').boundingBox();
  expect(weftBox!.x).toBeGreaterThanOrEqual(0);
  expect(weftBox!.x + weftBox!.width).toBeLessThanOrEqual(190);
  await page.screenshot({ path: testInfo.outputPath('shuttle-speaking.png'), omitBackground: true });
  await page.screenshot({ path: testInfo.outputPath('shuttle-speaking-dark.png'), style: 'html { background: #10151a !important; }' });
  await page.screenshot({ path: testInfo.outputPath('shuttle-speaking-light.png'), style: 'html { background: #eef1f5 !important; }' });
  const loud = await meter.innerHTML();
  await emit(page, 'capture:event', { generation: 0, kind: 'capture-level', level: 0, request_id: 'stale' });
  await expect(shuttle).toHaveCSS('--shuttle-energy', '1');
  expect(await meter.innerHTML()).toBe(loud);
});

test('The shuttle immediately stops new animations and transitions when Reduce Motion changes live', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await openOverlay(page);
  const shuttle = page.locator('.hud-shuttle');
  await expect(shuttle.locator('.hud-shuttle__flow').first()).toHaveCSS('animation-name', 'hud-shuttle-flow');
  await fillLevels(page, 1);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(shuttle.locator('.hud-shuttle__flow').first()).toHaveCSS('animation-name', 'none');
  expect(await shuttle.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
  await fillLevels(page, 0);
  expect(await shuttle.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
  for (const node of await shuttle.locator('*').all()) {
    await expect(node).toHaveCSS('transition-duration', '0s');
    await expect(node).toHaveCSS('will-change', 'auto');
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await expect(shuttle.locator('.hud-shuttle__flow').first()).toHaveCSS('animation-name', 'hud-shuttle-flow');
});

for (const platform of ['MacIntel', 'Linux x86_64']) {
  test(`The shuttle stays put through transcribing and unmounts for every result while the live region remains (${platform})`, async ({ page }, testInfo) => {
    const pasteModifier = platform === 'MacIntel' ? 'Command' : 'Control';
    await page.addInitScript((value) => {
      Object.defineProperty(navigator, 'platform', { value, configurable: true });
    }, platform);
    await openOverlay(page);
    const status = page.getByRole('status');
    await status.evaluate((node) => node.setAttribute('data-original-status', 'true'));
    const shuttle = page.locator('.hud-shuttle');
    const pill = page.locator('.recording--overlay');
    await emit(page, 'overlay:waveform', { waveform: 'speaking' });
    await fillLevels(page, 1);
    await expect(shuttle).toHaveCSS('--shuttle-energy', '1');
    // Let the energy opacity transitions settle before snapshotting styles.
    await expect.poll(() => shuttle.evaluate((node) => node.getAnimations({ subtree: true })
      .filter((animation) => animation instanceof CSSTransition).length)).toBe(0);
    const continuity = await pill.evaluateHandle((node) => {
      const nodes = [node, ...node.querySelectorAll('.hud-shuttle, .hud-shuttle *')];
      const properties = ['background-color', 'border-color', 'border-radius', 'opacity', 'filter', 'mask-image', 'mask-composite', 'padding'];
      const styles = nodes.map((element) => ({
        box: element.classList.contains('hud-shuttle__flow')
            ? { width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }
            : element.getBoundingClientRect().toJSON(),
        style: properties.map((property) => getComputedStyle(element).getPropertyValue(property)),
      }));
      const animations = [...node.querySelectorAll('.hud-shuttle__flow')].flatMap((element) => element.getAnimations());
      nodes.forEach((element, index) => element.setAttribute('data-continuity-token', String(index)));
      return { nodes, styles, properties, animations };
    });
    await expect.poll(() => continuity.evaluate(({ animations }) => animations.every((animation) => Number(animation.currentTime) > 250))).toBe(true);
    const times = await continuity.evaluate(({ animations }) => animations.map((animation) => Number(animation.currentTime)));
    expect(times).toHaveLength(2);
    await emit(page, 'overlay:waveform', { waveform: 'processing' });
    await expect(shuttle).toHaveCount(1);
    await expect(shuttle).toHaveCSS('--shuttle-energy', '1');
    const after = await continuity.evaluate(({ nodes, properties, animations }) => {
      const current = [document.querySelector('.recording--overlay')!, ...document.querySelectorAll('.hud-shuttle, .hud-shuttle *')];
      const currentAnimations = [...document.querySelectorAll('.hud-shuttle__flow')].flatMap((element) => element.getAnimations());
      return {
        sameNodes: current.length === nodes.length && current.every((element, index) => element === nodes[index] && element.getAttribute('data-continuity-token') === String(index)),
        sameAnimations: currentAnimations.length === animations.length && currentAnimations.every((animation, index) => animation === animations[index]),
        styles: current.map((element) => ({
          box: element.classList.contains('hud-shuttle__flow')
            ? { width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height }
            : element.getBoundingClientRect().toJSON(),
          style: properties.map((property) => getComputedStyle(element).getPropertyValue(property)),
        })),
      };
    });
    expect(after.sameNodes).toBe(true);
    expect(after.sameAnimations).toBe(true);
    expect(after.styles).toEqual(await continuity.evaluate(({ styles }) => styles));
    await expect.poll(async () => (await continuity.evaluate(({ animations }) => animations.map((animation) => Number(animation.currentTime))))
      .every((time, index) => time > times[index])).toBe(true);
    await fillLevels(page, 0); // Late capture levels must not change processing energy.
    await expect(shuttle).toHaveCSS('--shuttle-energy', '1');
    await expect(page.getByRole('img', { name: 'Microphone level' })).toHaveCount(0);
    await expect(page.locator('.hud-transcribing')).toHaveCount(1);
    await expect(page.locator('.hud-transcribing')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('button, input, [tabindex]')).toHaveCount(0);
    await expect(status).toHaveAttribute('data-original-status', 'true');
    await expect(status).toHaveText('Transcribing');
    await expect(page.locator('.hud-transcribing')).toHaveCSS('animation-name', 'hud-pulse');
    // The finished thread pays out of the text eyelet while the rope is twisted.
    const payout = page.locator('.hud-payout');
    await expect(payout).toHaveAttribute('aria-hidden', 'true');
    await expect(payout).toHaveCSS('animation-name', 'hud-payout');
    const processingBox = await pill.boundingBox();
    expect(processingBox?.width).toBe(142);
    expect(processingBox?.height).toBe(28);
    expect(processingBox!.x).toBeGreaterThanOrEqual(24);
    expect(processingBox!.y).toBeGreaterThanOrEqual(24);
    expect(processingBox!.x + processingBox!.width).toBeLessThanOrEqual(190 - 24);
    expect(processingBox!.y + processingBox!.height).toBeLessThanOrEqual(76 - 24);
    const ropeBox = await page.locator('.hud-transcribing').boundingBox();
    expect(ropeBox!.x).toBeGreaterThanOrEqual(processingBox!.x);
    expect(ropeBox!.x + ropeBox!.width).toBeLessThanOrEqual(processingBox!.x + processingBox!.width);
    const payoutBox = await payout.boundingBox();
    expect(payoutBox!.x + payoutBox!.width).toBeLessThanOrEqual(190);
    await page.screenshot({ path: testInfo.outputPath('shuttle-processing.png'), omitBackground: true });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await shuttle.evaluate((node) => node.getAnimations({ subtree: true }).length)).toBe(0);
    for (const node of await shuttle.locator('*').all()) {
      await expect(node).toHaveCSS('animation-name', 'none');
      await expect(node).toHaveCSS('transition-duration', '0s');
      await expect(node).toHaveCSS('will-change', 'auto');
    }
    await expect(page.locator('.hud-transcribing')).toHaveCSS('animation-name', 'hud-breathe');
    await expect(page.locator('.hud-transcribing i')).toHaveCSS('animation-name', 'none');
    await expect(payout).toHaveCSS('animation-name', 'none');
    await expect(payout).toBeVisible(); // Still shows where the text will go, without moving.
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await expect(shuttle.locator('.hud-shuttle__flow').first()).toHaveCSS('animation-name', 'hud-shuttle-flow');
    await expect(page.locator('.hud-transcribing')).toHaveCSS('animation-name', 'hud-pulse');
    await continuity.dispose();
    await page.setViewportSize({ width: 248, height: 40 });
    for (const [waveform, result, text] of [
      ['result-copied', 'copied', `Copied. Press ${pasteModifier} V to paste`],
      ['result-unverified', 'maybe-copied', `May have been inserted; also copied. If it's missing, press ${pasteModifier} V to paste.`],
      ['result-failed', 'insert-failed', 'Couldn’t insert'],
      ['result-failed', 'transcribe-failed', 'Couldn’t transcribe'],
    ] as const) {
      await emit(page, 'overlay:waveform', { result, waveform });
      await expect(page.locator('.hud-shuttle')).toHaveCount(0);
      await expect(page.locator('.hud-transcribing')).toHaveCount(0);
      await expect(status).toHaveAttribute('data-original-status', 'true');
      await expect(status).toHaveText(text);
      await expect(page.locator('[role="status"]')).toHaveCount(1);
      const box = await page.locator('.hud-result').boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(4);
      expect(box!.x + box!.width).toBeLessThanOrEqual(244);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(40);
      // The message sits inside the tag's straight section, clear of its pointed tips.
      const tag = await page.locator('.hud-result__tag').boundingBox();
      const words = await page.locator('.hud-result__text').evaluate((node) => {
        const range = document.createRange();
        range.selectNodeContents(node);
        return range.getBoundingClientRect().toJSON() as DOMRect;
      });
      expect(words.left).toBeGreaterThanOrEqual(tag!.x + 20);
      expect(words.right).toBeLessThanOrEqual(tag!.x + tag!.width - 20);
      await page.screenshot({ path: testInfo.outputPath(`shuttle-${result}.png`), omitBackground: true });
    }
    await page.setViewportSize({ width: 190, height: 76 });
    await emit(page, 'overlay:waveform', { waveform: 'silent' });
    await expect(page.locator('.hud-shuttle')).toHaveCount(1);
    await expect(status).toHaveText('');
    await expect(page.locator('.hud-shuttle')).toHaveCSS('--shuttle-energy', '0');
  });
}
