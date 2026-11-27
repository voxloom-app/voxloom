import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../../src');
const css = (name: string) => readFileSync(join(root, 'styles', name), 'utf8');

const tokensFile = css('tokens.css');

/** First `{...}` block that follows `header`. */
function blockAfter(source: string, header: string): string {
  const at = source.indexOf(header);
  if (at < 0) throw new Error(`missing ${header}`);
  const start = source.indexOf('{', at);
  const end = source.indexOf('}', start);
  if (start < 0 || end < 0) throw new Error(`unclosed ${header}`);
  return source.slice(start, end + 1);
}

function hexToken(block: string, name: string): string {
  const match = block.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`missing ${name}`);
  return match[1].toLowerCase();
}

const light = blockAfter(tokensFile, '[data-appearance-resolved="light"]');
const dark = blockAfter(tokensFile, ':root');

describe('Light Frost + mint palette and V3 Layered Home actions', () => {
  const tokens = tokensFile;
  const actions = css('home-actions.css');

  it('adds light-only mint tokens and leaves :root (dark) colors unchanged', () => {
    expect(tokens).toMatch(/\[data-appearance-resolved="light"\] \{[^}]*--mint: #e8f6ee;[^}]*--mint-line: #c4e3cf;[^}]*--seg-on-fg: #0f3d1c;/);
    // ui-iter-01: the Home hero and Dictate card moved onto the dark voice stage, so their washes are gone.
    expect(tokens).not.toMatch(/--(hero|dictate)-wash/);
    expect(tokens).not.toMatch(/:root \{[^}]*--mint:/);
    const rootBlock = tokens.split('[data-appearance-resolved="light"]')[0];
    expect(rootBlock).toMatch(/:root \{[^}]*--bg: #0b0b10;[^}]*--side: #0e0e14;[^}]*--panel: #121219;[^}]*--field: #1a1a23;[^}]*--seg: #1c1c26;[^}]*--segon: #2c2c3a;[^}]*--line: #23232e;[^}]*--fg: #ececf1;[^}]*--mut: #9494a3;[^}]*--ctl-line: #6a6a80;[^}]*--navon: #2a2a38;[^}]*--accfg: #b6ff3c;/);
  });

  it('styles the selected chip label with --seg-on-fg, falling back to --fg in dark', () => {
    expect(css('ui-controls.css')).toMatch(/\.seg__item\.on \{[^}]*color: var\(--seg-on-fg, var\(--fg\)\);/);
  });

  it('dictates from the stage\'s weft, not a Home deck or the rail (ui-iter-21)', () => {
    expect(readFileSync(join(root, 'features/home/Home.tsx'), 'utf8')).not.toContain('home-card--dictate');
    expect(readFileSync(join(root, 'features/home/LoomBar.tsx'), 'utf8')).toContain('className="dictate__button"');
    expect(readFileSync(join(root, 'app/shell/Sidebar.tsx'), 'utf8')).not.toMatch(/dictate__button|DictateCapsule|LoomBar/);
    expect(css('stage.css')).not.toContain('.home-card--dictate');
  });

  it('scopes V3 Layered rules to Home actions, keeps ghost links, and stills motion', () => {
    // ui-iter-01: Home actions sit on the dark stage in both themes: no light-only washes,
    // one set of attached shadows; the stage ends on the hero since ui-iter-15.
    expect(actions).not.toContain('[data-appearance-resolved=');
    expect(actions).toMatch(/\.btn\.primary\.big:not\(:disabled\) \{[^}]*box-shadow:/);
    expect(actions).toContain('.btn.primary.big');
    expect(actions).toContain('.home .btn:not(.primary):not(.ghost)');
    expect(actions).toMatch(/\.btn\.primary\.big:disabled \{[^}]*box-shadow: none;[^}]*transform: none;/);
    expect(actions).toMatch(/\.btn\.primary\.big:hover:not\(:disabled\)[^}]*transform: translateY\(-1px\)/);
    expect(actions).toContain('@media (prefers-reduced-motion: reduce)');
    expect(actions).toContain('.btn.primary.big { transition: none; }');
    expect(actions).toMatch(/\.btn\.primary\.big:active:not\(:disabled\) \{ transform: none; \}/);
  });

  it('imports home-actions.css immediately after home.css', () => {
    expect(css('index.css')).toMatch(/@import "\.\/home\.css";\n@import "\.\/home-actions\.css";\n@import "\.\/stage\.css";/);
  });
});

describe('Frost + mint AA contrast (29 pairs)', () => {
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const hex = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
  const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(hex(a)), lum(hex(b))].sort((m, n) => n - m);
    return (x + 0.05) / (y + 0.05);
  };
  const mix = (a: string, b: string, t: number) => '#' + hex(a).map((v, i) => Math.round(v * t + hex(b)[i] * (1 - t)).toString(16).padStart(2, '0')).join('');

  const L = {
    bg: hexToken(light, '--bg'),
    side: hexToken(light, '--side'),
    panel: hexToken(light, '--panel'),
    field: hexToken(light, '--field'),
    seg: hexToken(light, '--seg'),
    segon: hexToken(light, '--segon'),
    navon: hexToken(light, '--navon'),
    fg: hexToken(light, '--fg'),
    mut: hexToken(light, '--mut'),
    mutNav: hexToken(light, '--mut-on-nav'),
    ctl: hexToken(light, '--ctl-line'),
    acc: hexToken(light, '--accfg'),
    mint: hexToken(light, '--mint'),
    ok: hexToken(light, '--ok'),
    info: hexToken(light, '--info'),
    warn: hexToken(light, '--warn'),
    err: hexToken(light, '--err'),
    switchOn: hexToken(light, '--switch-on'),
    segOnFg: hexToken(light, '--seg-on-fg'),
  };
  const D = {
    panel: hexToken(dark, '--panel'),
    field: hexToken(dark, '--field'),
    fg: hexToken(dark, '--fg'),
    ctl: hexToken(dark, '--ctl-line'),
    segon: hexToken(dark, '--segon'),
    sel: hexToken(dark, '--sel-edge'),
    acc: hexToken(dark, '--accfg'),
  };
  const ink = hexToken(dark, '--on-brand');
  const brandA = hexToken(dark, '--brand-a');
  const brandB = hexToken(dark, '--brand-b');
  // Official pairs: 16% accent over mint (hero glow), 10% badge tints, 38% white sheen on cyan, 25% pressed inset, 6% white highlight on the dark Copy button.
  const hero = mix(L.acc, L.mint, 0.16);
  const okBadge = mix(L.ok, L.bg, 0.1);
  const infoBadge = mix(L.info, L.bg, 0.1);
  const errBadge = mix(L.err, L.panel, 0.1);
  const sheenCyan = mix('#ffffff', brandB, 0.38);
  const pressedCyan = mix('#00281e', brandB, 0.25);
  const copyHighlight = mix('#ffffff', D.panel, 0.06);

  it('passes every listed pair at the documented minimum', () => {
    const pairs: [string, string, string, number][] = [
      ['L body text (worst: hero)', L.fg, hero, 4.5],
      ['L muted / help (worst: hero)', L.mut, hero, 4.5],
      ['L muted on selected nav', L.mutNav, L.navon, 4.5],
      ['L green accent / View all (worst: hero)', L.acc, hero, 4.5],
      ['L white on green', '#ffffff', L.acc, 4.5],
      ['L selected chip label', L.segOnFg, L.segon, 4.5],
      ['L badge Inserted (10% tint on bg)', L.ok, okBadge, 4.5],
      ['L badge Copied (10% tint on bg)', L.info, infoBadge, 4.5],
      ['L badge Failed (10% tint on panel)', L.err, errBadge, 4.5],
      ['L warning text on bg', L.warn, L.bg, 4.5],
      ['L control borders (worst: seg)', L.ctl, L.seg, 3],
      ['L focus ring / sel-edge (worst: hero)', L.acc, hero, 3],
      ['L switch off track (worst: side)', L.ctl, L.side, 3],
      ['L switch on track (worst: side)', L.switchOn, L.side, 3],
      ['Start label vs lime stop', ink, brandA, 4.5],
      ['Start label vs cyan stop below sheen', ink, brandB, 4.5],
      ['Start label vs cyan under sheen', ink, sheenCyan, 4.5],
      ['Start label at pressed inset edge', ink, pressedCyan, 4.5],
      ['L Start focus ring vs white gap', L.acc, L.panel, 3],
      ['L Start focus ring vs Dictate mint wash', L.acc, L.mint, 3],
      ['D Start focus ring vs panel gap', D.acc, D.panel, 3],
      ['D panel gap vs button cyan edge', D.panel, brandB, 3],
      ['L Copy label on panel', L.fg, L.panel, 4.5],
      ['L Copy border vs transcript box', L.ctl, L.field, 3],
      ['D Copy label on 6% highlight', D.fg, copyHighlight, 4.5],
      ['D Copy border vs transcript box', D.ctl, D.field, 3],
      ['D selected chip label / segon', D.fg, D.segon, 4.5],
      ['D selected chip edge vs segon', D.sel, D.segon, 3],
      ['D View all link on panel', D.acc, D.panel, 4.5],
    ];
    expect(pairs).toHaveLength(29);
    for (const [label, a, b, min] of pairs) {
      expect(ratio(a, b), `${label}: ${a} on ${b}`).toBeGreaterThanOrEqual(min);
    }
  });
});

describe('V3 Layered regular primaries', () => {
  const layered = css('primary-layered.css');

  it('imports primary-layered.css immediately before home.css, then home-actions.css', () => {
    expect(css('index.css')).toMatch(
      /@import "\.\/primary-layered\.css";\n@import "\.\/home\.css";\n@import "\.\/home-actions\.css";/,
    );
  });

  it('scopes every rule to :not(:disabled) except the reduced-motion transition: none line', () => {
    const withoutComments = layered.replace(/\/\*[\s\S]*?\*\//g, '');
    const selectors: string[] = [];
    for (const match of withoutComments.matchAll(/([^{}]+)\{/g)) {
      for (const selector of match[1].split(',')) {
        const trimmed = selector.replace(/\s+/g, ' ').trim();
        const start = trimmed.indexOf('.btn.primary');
        if (start >= 0) selectors.push(trimmed.slice(start));
      }
    }
    expect(selectors.length).toBeGreaterThan(0);
    const exempt = selectors.filter((selector) => !selector.includes(':not(:disabled)'));
    expect(exempt).toEqual(['.btn.primary']);
    expect(layered).toMatch(/\.btn\.primary \{ transition: none; \}/);
    expect(layered).toMatch(/@media \(prefers-reduced-motion: reduce\)/);
    expect(layered).toMatch(/transform: none/);
  });

  it('stays under 200 lines', () => {
    expect(layered.split('\n').length).toBeLessThan(200);
  });
});
