import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = (name: string) => readFileSync(join(__dirname, '../../src/styles', name), 'utf8');
const daylight = css('daylight.css');
const pages = css('daylight-pages.css');
const LIGHT = '[data-appearance-resolved="light"]';

/** Top-level rules as [selector list, body], with comments and @keyframes blocks removed. */
const rules = (source: string) => {
  const plain = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '');
  return [...plain.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => [m[1].trim(), m[2]] as const);
};
/** Splits a selector list on commas outside parentheses. */
const selectors = (list: string) => {
  const out: string[] = [];
  let depth = 0;
  let start = 0;
  [...list].forEach((ch, i) => {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { out.push(list.slice(start, i).trim()); start = i + 1; }
  });
  return [...out, list.slice(start).trim()];
};
const tokenBlock = rules(daylight).find(([sel]) => sel.includes('.stage, .sidebar'))![1];
const token = (name: string, body = tokenBlock) => new RegExp(`${name}:\\s*(#[0-9a-f]{6})`).exec(body)![1];
/** The window-level declarations: dyed threads and the linen. */
const threads = rules(daylight).find(([sel, body]) => sel === `${LIGHT} :is(.app, .settings-window-root, .setup-window)` && body.includes('--linen:'))![1];

const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const hex = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(hex(a)), lum(hex(b))].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
const mix = (a: string, b: string, t: number) => '#' + hex(a).map((v, i) => Math.round(v * t + hex(b)[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
/** The vivid colour and strength of a voice glow, read from its rule. */
const glow = (pseudo: string) => {
  const m = new RegExp(`\\.stage::${pseudo} \\{ background: radial-gradient\\([^,]+, color-mix\\(in srgb, (#[0-9a-f]{6}) (\\d+)%`).exec(pages)!;
  return [m[1], Number(m[2]) / 100] as const;
};

describe('The loom by daylight (ui-iter-10): Light gets its own material; dark keeps the night loom', () => {
  it('loads last, after the responsive sheet, so it settles every light surface', () => {
    const index = css('index.css').trim();
    expect(index.endsWith('@import "./responsive.css";\n@import "./daylight.css";\n@import "./daylight-pages.css";')).toBe(true);
  });

  it('touches only the light appearance: every rule is scoped to it, and the HUD is left alone', () => {
    for (const source of [daylight, pages]) {
      const all = rules(source).flatMap(([list]) => selectors(list));
      expect(all.length).toBeGreaterThan(20);
      for (const sel of all) expect(sel.startsWith(`${LIGHT} `), sel).toBe(true);
      // The in-app preview stays vivid; the floating window is never themed.
      expect(source).not.toMatch(/\.hud(?!-preview\b)|\.overlay/);
    }
    // Pseudo-elements are invalid inside :is() and would silently drop the whole selector.
    expect(`${daylight}\n${pages}`).not.toMatch(/:is\([^)]*::/);
    // Switching to daylight introduces no additional motion.
    expect(pages).not.toContain('@keyframes');
  });

  it('the frame is woven linen, and the dark frame still carries the night material', () => {
    expect(threads).toMatch(/--linen: #f4f1ea;/);
    expect(threads).toMatch(/--linen-low: #e9e4da;/);
    expect(threads).toMatch(/--linen-bg: repeating-linear-gradient\(0deg/);
    expect(daylight).toContain(`${LIGHT} :is(.app, .settings-window-root, .setup-window) { background: var(--linen-bg); }`);
    expect(css('stage.css')).toMatch(/linear-gradient\(180deg, #17171f, #0a0a0e\)/);
    expect(css('frame.css')).toMatch(/linear-gradient\(180deg, #17171f, #0a0a0e 100vh\)/);
  });

  it('threads are dyed for linen, while the lit things keep the vivid brand', () => {
    expect(token('--brand-a', threads)).toBe('#548a00');
    expect(token('--brand-b', threads)).toBe('#008a9e');
    const lit = rules(daylight).find(([sel]) => sel.includes('.btn.primary, .app-tile, .guided-mark, .hud-preview'))!;
    expect(lit[0].startsWith(LIGHT)).toBe(true);
    expect(token('--brand-a', lit[1])).toBe('#b6ff3c');
    expect(token('--brand-b', lit[1])).toBe('#3cf0ff');
  });

  describe('contrast over every daylight frame surface', () => {
    const top = token('--linen', threads);
    const low = token('--linen-low', threads);
    const [limeLight, limeStrength] = glow('before');
    const [cyanLight, cyanStrength] = glow('after');
    const surfaces: Record<string, string> = {
      'linen top': top,
      'linen low': low,
      'lime voice glow': mix(limeLight, low, limeStrength),
      'cyan voice glow': mix(cyanLight, low, cyanStrength),
      panel: token('--panel'),
      seg: token('--seg'),
      navon: token('--navon'),
      // The selected nav's lime tint over the rail's top-corner light.
      'selected nav': mix('#b6ff3c', mix('#b6ff3c', top, 0.22), 0.34),
    };

    it.each(['--fg', '--mut', '--accfg', '--ok', '--info', '--warn', '--err', '--focus'])('%s holds AA text (4.5:1)', (name) => {
      for (const [surface, bg] of Object.entries(surfaces)) expect(ratio(token(name), bg), `${name} on ${surface}`).toBeGreaterThanOrEqual(4.5);
    });

    it('muted text on the selected nav and the selected chip label hold AA', () => {
      expect(ratio(token('--mut-on-nav'), token('--navon'))).toBeGreaterThanOrEqual(4.5);
      expect(ratio(token('--mut-on-nav'), surfaces['selected nav'])).toBeGreaterThanOrEqual(4.5);
      expect(ratio(token('--seg-on-fg'), token('--segon'))).toBeGreaterThanOrEqual(4.5);
    });

    it('control borders, the selected marker, the switch track and the dyed threads hold 3:1', () => {
      for (const name of ['--ctl-line', '--sel-edge', '--switch-off']) {
        for (const bg of [top, low, token('--panel'), token('--field'), token('--seg')]) expect(ratio(token(name), bg), name).toBeGreaterThanOrEqual(3);
      }
      for (const thread of [token('--brand-a', threads), token('--brand-b', threads)]) {
        for (const bg of [top, low, surfaces['lime voice glow'], surfaces['cyan voice glow'], token('--panel')]) expect(ratio(thread, bg), thread).toBeGreaterThanOrEqual(3);
      }
    });
  });
});
