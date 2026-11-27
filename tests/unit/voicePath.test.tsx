import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { spokenCombo } from '../../src/components/KeyCombo';
import { initialSettings } from '../../src/domain/fixtures';
import { Settings } from '../../src/features/settings/Settings';
import { appearanceStop, speechModel, voicePathStops } from '../../src/features/settings/pathStops';
import { renderWithApp } from './testUtils';

const css = (name: string) => readFileSync(join(__dirname, '../../src/styles', name), 'utf8');
const path = () => screen.getByRole('tablist', { name: 'Settings sections' });
const stops = () => within(path()).getAllByRole('tab');
const tied = () => [...path().querySelectorAll('[role="tab"][data-current]')].map((tab) => tab.getAttribute('data-stop'));
const said = (stops: { lead: string; phrase: string; tail: string }[]) => stops.map((s) => `${s.lead}${s.phrase}${s.tail}`).join('');

describe('voice path stops (ui-iter-04), said as a sentence (ui-iter-41)', () => {
  it('lists the six stops in the order a dictation passes them, from saved settings only', () => {
    const path = voicePathStops(initialSettings, true, true);
    const keys = spokenCombo('Ctrl + Shift + Space', true);
    expect(path.map((s) => s.id)).toEqual(['shortcut', 'microphone', 'speech', 'cleanup', 'output', 'transcripts']);
    expect(path.map((s) => s.phrase)).toEqual([
      keys, 'your default microphone', 'Whisper Base (English)', 'cleanup is off', 'inserted at your cursor, or copied', 'kept for 30 days',
    ]);
    expect(said(path)).toBe(`Hold ${keys} and Voxloom listens through your default microphone. Whisper Base (English) turns what you`
      + ' say into words on this Mac, cleanup is off, and the words are inserted at your cursor, or copied. Transcripts are kept for 30 days.');
    // Every accessible name starts with the label and then says the visible words.
    expect(path.map((s) => s.name)).toEqual([
      `Shortcut: ${keys}. Hold to dictate`,
      'Microphone: your default microphone',
      'Speech: Whisper Base (English)',
      'Cleanup: cleanup is off',
      'Output: inserted at your cursor, or copied',
      'Transcripts: kept for 30 days',
    ]);
  });

  it('follows each setting a stop summarises, and the sentence still reads', () => {
    const path = voicePathStops({
      ...initialSettings,
      cleanupOptIn: true,
      clipboardFallback: false,
      microphone: 'usb-input',
      shortcut: '',
      style: 'very-casual',
      transcriptRetention: 'off',
    }, false, true);
    const byId = Object.fromEntries(path.map((s) => [s.id, s]));
    expect(byId.shortcut).toMatchObject({ name: 'Shortcut: none. Not active', phrase: 'a shortcut' });
    expect(byId.microphone.phrase).toBe('the microphone you chose');
    expect(byId.cleanup.phrase).toBe('cleanup tidies them in Very Casual style');
    expect(byId.output.name).toBe('Output: inserted at your cursor');
    expect(byId.transcripts.phrase).toBe('not kept');
    expect(said(path)).toBe('Choose a shortcut so Voxloom can listen through the microphone you chose. Whisper Base (English) turns what'
      + ' you say into words on this Mac, cleanup tidies them in Very Casual style, and the words are inserted at your cursor.'
      + ' Transcripts are not kept, apart from the last one on Home.');
    expect(speechModel('whisper-base.en')).toEqual({ language: 'English', name: 'Whisper Base' });
  });

  it('says Appearance on its own line: the look and the text size', () => {
    expect(appearanceStop(initialSettings)).toEqual({
      id: 'appearance', label: 'Appearance', lead: 'On screen, Voxloom ', name: 'Appearance: follows your system’s look',
      phrase: 'follows your system’s look', tail: '.',
    });
    expect(appearanceStop({ ...initialSettings, appearance: 'dark', textSize: 'large' }))
      .toMatchObject({ name: 'Appearance: stays dark, with large text', phrase: 'stays dark, with large text' });
  });
});

describe('voice path in Settings: the sentence’s parts are the tabs (ui-iter-13, ui-iter-41)', () => {
  it('draws one tab per stop plus Appearance, and marks only the open one', async () => {
    const user = userEvent.setup();
    renderWithApp(<Settings onSetup={vi.fn()} />);
    expect(stops().map((b) => b.getAttribute('aria-label')?.split(':')[0]))
      .toEqual(['Shortcut', 'Microphone', 'Speech', 'Cleanup', 'Output', 'Transcripts', 'Appearance']);
    expect(tied()).toEqual(['shortcut']);
    expect(path()).toHaveTextContent(/and Voxloom listens through your default microphone\. Whisper Base \(English\) turns what you say/);
    // Appearance sits apart from the dictation's sentence.
    expect(path().querySelector('.path-sentence__look [role="tab"]')).toHaveAttribute('data-stop', 'appearance');
    expect(screen.queryByRole('navigation', { name: 'Voice path' })).toBeNull();
    await user.click(screen.getByRole('tab', { name: /^Appearance:/ }));
    expect(tied()).toEqual(['appearance']);
  });

  it('opens a part from the keyboard with Enter or Space, as a button would', async () => {
    const user = userEvent.setup();
    renderWithApp(<Settings onSetup={vi.fn()} />);
    const output = screen.getByRole('tab', { name: /^Output:/ });
    output.focus();
    await user.keyboard('{Enter}');
    expect(tied()).toEqual(['output']);
    const look = screen.getByRole('tab', { name: /^Appearance:/ });
    look.focus();
    await user.keyboard(' ');
    expect(tied()).toEqual(['appearance']);
    expect(screen.getByRole('tabpanel', { name: /^Appearance:/ })).toBeInTheDocument();
  });

  it('opens a stop’s pane, and changing the setting there updates the stop', async () => {
    const user = userEvent.setup();
    renderWithApp(<Settings onSetup={vi.fn()} />);
    await user.click(screen.getByRole('tab', { name: /^Output:/ }));
    expect(tied()).toEqual(['output']);
    const panel = screen.getByRole('tabpanel', { name: /^Output:/ });
    expect(panel).toHaveAttribute('data-pane', 'output');
    expect(panel).toHaveTextContent('never presses Return or Send');
    await user.click(within(panel).getByRole('switch', { name: 'Clipboard fallback' }));
    expect(screen.getByRole('tab', { name: 'Output: inserted at your cursor' })).toHaveAttribute('aria-selected', 'true');
  });

  it('Transcripts opens retention and recovery; Speech opens the model list', async () => {
    const user = userEvent.setup();
    renderWithApp(<Settings onSetup={vi.fn()} />);
    await user.click(screen.getByRole('tab', { name: /^Transcripts:/ }));
    expect(tied()).toEqual(['transcripts']);
    expect(screen.getByRole('radiogroup', { name: 'Transcript retention' })).toBeInTheDocument();
    await user.click(screen.getByRole('tab', { name: /^Speech:/ }));
    expect(await screen.findByText('whisper-base.en')).toBeInTheDocument();
    expect(screen.getByLabelText('Language')).toBeInTheDocument();
  });

  it('names the native window after the open pane', async () => {
    const onTabTitle = vi.fn();
    renderWithApp(<Settings onSetup={vi.fn()} onTabTitle={onTabTitle} />);
    expect(onTabTitle).toHaveBeenLastCalledWith('Shortcut');
    await userEvent.setup().click(screen.getByRole('tab', { name: /^Transcripts:/ }));
    expect(onTabTitle).toHaveBeenLastCalledWith('Transcripts & privacy');
  });
});

describe('voice path styles', () => {
  const pathCss = css('settings-path.css');

  it('puts the Settings header on the stage material in both themes', () => {
    expect(pathCss).toMatch(/\.settings-window__bar\.stage \{[^}]*linear-gradient\(180deg, #17171f, #0a0a0e\);/);
    expect(css('index.css')).toMatch(/@import "\.\/settings\.css";\n@import "\.\/settings-path\.css";/);
  });

  it('sets the parts inline, so a long one wraps with the sentence, and stills them under reduced motion', () => {
    const stop = pathCss.slice(pathCss.indexOf('.path-sentence__stop {'), pathCss.indexOf('}', pathCss.indexOf('.path-sentence__stop {')));
    expect(stop).toContain('box-decoration-break: clone;');
    expect(stop).not.toMatch(/display: (inline-)?(block|flex)/);
    expect(pathCss).toMatch(/\.path-sentence__stop:focus-visible \{ outline: 2px solid var\(--focus\);/);
    const reduced = pathCss.slice(pathCss.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.path-sentence__stop { transition: none; }');
    // The pulse, the threads and the walk went with ui-iter-41: the sentence is the path.
    expect(pathCss).not.toContain('voice-path');
    expect(pathCss.split('\n').length).toBeLessThan(200);
  });

  it('keeps the pane head’s entrance, and holds it still under reduced motion', () => {
    const panes = css('settings-panes.css');
    expect(css('index.css')).toMatch(/@import "\.\/settings-path\.css";\n@import "\.\/settings-panes\.css";/);
    expect(panes).toMatch(/\.settings-pane__head \{[^}]*animation: pane-in/);
    const reduced = panes.slice(panes.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.settings-pane__head { animation: none; }');
    expect(panes).not.toMatch(/settings-pane__(walk|where|step)|voice-path/);
  });

  it('keeps the sentence at AA over the stage, its glows, a hovered part and the open part, in both themes', () => {
    const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const hex = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
    const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(hex(a)), lum(hex(b))].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    const mix = (a: string, b: string, t: number) => '#' + hex(a).map((v, i) => Math.round(v * t + hex(b)[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
    const tokens = (file: string, selector: string) => {
      const text = css(file);
      const block = text.slice(text.indexOf(selector), text.indexOf('}', text.indexOf(selector)));
      return (name: string) => new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(block)![1];
    };
    const night = tokens('stage.css', '.stage {');
    const day = tokens('daylight.css', ':is(.stage, .sidebar');
    const dyes = tokens('daylight.css', ':is(.app, .settings-window-root, .setup-window) {\n  --brand-a');
    // The part's thread runs lime to cyan by stop: the ends and the middle.
    const threads = (a: string, b: string) => [a, mix(a, b, 0.5), b];
    // Plates are pinned in the stylesheets: 15% of the thread at night, 13% on white by day.
    expect(pathCss).toContain('--plate: color-mix(in srgb, var(--knot) 15%, transparent);');
    expect(css('daylight-pages.css')).toContain('.path-sentence__stop { --plate: color-mix(in srgb, var(--knot) 13%, #ffffff); }');
    const themes = [{
      name: 'dark',
      fg: night('fg'), mut: night('mut'), open: '#f6f6f9', focus: '#b6ff3c', base: ['#17171f', '#0a0a0e'],
      // The stage's side glows at full strength (18% × .5 lime, 16% × .55 cyan).
      glows: [mix('#b6ff3c', '#17171f', 0.09), mix('#3cf0ff', '#17171f', 0.088)],
      hover: (under: string) => mix('#ffffff', under, 0.045),
      threads: threads('#b6ff3c', '#3cf0ff'),
      plate: (knot: string, under: string) => mix(knot, under, 0.15),
      lookPlate: (under: string) => mix('#ffffff', under, 0.1),
    }, {
      name: 'light',
      fg: day('fg'), mut: day('mut'), open: day('fg'), focus: day('focus'), base: [dyes('linen'), dyes('linen-low')],
      // Sunlit glows on the linen (30% × .5 lime, 26% × .55 cyan).
      glows: [mix('#b6ff3c', dyes('linen'), 0.15), mix('#3cf0ff', dyes('linen'), 0.143)],
      hover: (under: string) => mix('#ffffff', under, 0.55),
      threads: threads(dyes('brand-a'), dyes('brand-b')),
      plate: (knot: string) => mix(knot, '#ffffff', 0.13),
      lookPlate: (under: string) => mix('#ffffff', under, 0.75),
    }];
    for (const t of themes) {
      const grounds = [...t.base, ...t.glows];
      for (const ground of grounds) {
        expect(ratio(t.mut, ground), `${t.name} joining words on ${ground}`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(t.fg, ground), `${t.name} part on ${ground}`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(t.fg, t.hover(ground)), `${t.name} hovered part on ${ground}`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(t.focus, ground), `${t.name} focus ring on ${ground}`).toBeGreaterThanOrEqual(3);
        // The open part: its words on the plate, and the thread drawn solid along its foot at 3:1.
        const plates = [...t.threads.map((knot) => [knot, t.plate(knot, ground)]), [t.fg, t.lookPlate(ground)]];
        for (const [knot, plate] of plates) {
          expect(ratio(t.open, plate), `${t.name} open part on ${plate}`).toBeGreaterThanOrEqual(4.5);
          expect(ratio(knot, plate), `${t.name} open part's thread ${knot} on ${plate}`).toBeGreaterThanOrEqual(3);
          expect(ratio(t.focus, plate), `${t.name} focus ring on ${plate}`).toBeGreaterThanOrEqual(3);
        }
      }
    }
    // Key caps, live and inactive.
    expect(ratio('#f6f6f9', '#32323f'), 'key cap').toBeGreaterThanOrEqual(4.5);
    expect(ratio(night('mut'), '#32323f'), 'inactive key cap').toBeGreaterThanOrEqual(4.5);
  });
});
