import { readFileSync } from 'node:fs';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SHUTTLE_PATH, ShuttleGlyph } from '../../src/components/ShuttleGlyph';
import { OverlayWaveformView } from '../../src/overlay/OverlayWaveformView';

describe('HUD shuttle (ui-iter-06)', () => {
  it('sets reactive energy to the mean of the 24-sample level history', () => {
    const { container, rerender } = render(<OverlayWaveformView levels={[]} waveform="silent" />);
    const energy = () => container.querySelector<HTMLElement>('.hud-shuttle')?.style.getPropertyValue('--shuttle-energy');
    expect(energy()).toBe('0');
    rerender(<OverlayWaveformView levels={Array<number>(24).fill(0.5)} waveform="speaking" />);
    expect(energy()).toBe('0.5');
    rerender(<OverlayWaveformView levels={[...Array<number>(18).fill(0), ...Array<number>(6).fill(1)]} waveform="speaking" />);
    expect(energy()).toBe('0.25');
    rerender(<OverlayWaveformView levels={Array<number>(24).fill(1)} waveform="speaking" />);
    expect(energy()).toBe('1');
  });

  it('runs the thread in at the voice eyelet and out at the text eyelet', () => {
    const { container } = render(<OverlayWaveformView levels={[]} waveform="silent" />);
    const shuttle = container.querySelector('.hud-shuttle')!;
    expect(shuttle.querySelector('.hud-shuttle__eye--in')).not.toBeNull();
    expect(shuttle.querySelector('.hud-shuttle__eye--out')).not.toBeNull();
    expect(shuttle.querySelectorAll('.hud-shuttle__weft')).toHaveLength(1);
    // The meter is the braid: three strands, each in its own colour.
    const meter = screen.getByRole('img', { name: 'Microphone level' });
    for (const strand of [0, 1, 2]) expect(meter.querySelector(`.wave__strand--${strand}`)).not.toBeNull();
  });

  it('retains the shuttle during processing without replacing its nodes or live region', () => {
    const levels = Array<number>(24).fill(0.5);
    const { container, rerender } = render(<OverlayWaveformView levels={levels} waveform="silent" />);
    const status = screen.getByRole('status');
    for (const waveform of ['silent', 'speaking'] as const) {
      rerender(<OverlayWaveformView levels={levels} waveform={waveform} />);
      const shuttle = container.querySelector('.hud-shuttle');
      expect(shuttle).not.toBeNull();
      expect(shuttle).toHaveAttribute('aria-hidden', 'true');
      expect(shuttle?.textContent).toBe('');
      expect(screen.getByRole('img', { name: 'Microphone level' })).toBeInTheDocument();
      expect(screen.getAllByRole('status')).toEqual([status]);
      expect(status).toHaveTextContent('');
      expect(container.querySelector('button, input, [tabindex]')).toBeNull();
    }
    const body = container.querySelector('.recording--overlay');
    const shuttle = container.querySelector<HTMLElement>('.hud-shuttle');
    const decorationNodes = [...shuttle!.querySelectorAll('*')];
    rerender(<OverlayWaveformView levels={levels} waveform="processing" />);
    expect(container.querySelector('.recording--overlay')).toBe(body);
    expect(container.querySelector('.hud-shuttle')).toBe(shuttle);
    expect(shuttle).toHaveStyle('--shuttle-energy: 0.5');
    const processingNodes = [...container.querySelectorAll('.hud-shuttle *')];
    expect(processingNodes).toHaveLength(decorationNodes.length);
    processingNodes.forEach((node, index) => expect(node).toBe(decorationNodes[index]));
    expect(container.querySelector('.wave')).toBeNull();
    for (const selector of ['.hud-transcribing', '.hud-payout']) {
      expect(container.querySelectorAll(selector)).toHaveLength(1);
      expect(container.querySelector(selector)).toHaveAttribute('aria-hidden', 'true');
    }
    expect(container.querySelector('button, input, [tabindex]')).toBeNull();
    expect(screen.getAllByRole('status')).toEqual([status]);
    expect(status).toHaveTextContent('Transcribing');
    for (const [waveform, result, announcement] of [
      ['result-copied', 'copied', 'Copied. Press Command V to paste'],
      ['result-unverified', 'maybe-copied', 'May have been inserted; also copied. If it\'s missing, press Command V to paste.'],
      ['result-failed', 'insert-failed', 'Couldn’t insert'],
      ['result-failed', 'transcribe-failed', 'Couldn’t transcribe'],
    ] as const) {
      rerender(<OverlayWaveformView levels={levels} mac result={result} waveform={waveform} />);
      expect(container.querySelector('.hud-shuttle')).toBeNull();
      expect(container.querySelector('.hud-payout')).toBeNull();
      expect(screen.getByRole('status')).toBe(status);
      expect(status).toHaveTextContent(announcement);
    }
  });

  it('ties each result off with a knot whose shape, not only its colour, tells the outcome', () => {
    const knot = (waveform: 'result-copied' | 'result-unverified' | 'result-failed') => {
      const { container, unmount } = render(<OverlayWaveformView levels={[]} mac result="copied" waveform={waveform} />);
      const svg = container.querySelector('.hud-result__knot')!;
      const shape = {
        core: svg.querySelector('.hud-result__core')?.tagName.toLowerCase() ?? null,
        fray: svg.querySelector('.hud-result__fray') !== null,
        leads: container.querySelectorAll('.hud-result__lead').length,
      };
      unmount();
      return shape;
    };
    expect(knot('result-copied')).toEqual({ core: 'circle', fray: false, leads: 2 }); // tied
    expect(knot('result-unverified')).toEqual({ core: 'path', fray: false, leads: 2 }); // half-tied
    expect(knot('result-failed')).toEqual({ core: null, fray: true, leads: 2 }); // frayed
    const css = readFileSync('src/styles/hud.css', 'utf8');
    expect(css).toMatch(/\.hud-result--failed \.hud-result__lead--out \{ visibility: hidden; \}/);
    expect(css).toMatch(/\.hud-result__knot \.hud-result__fray \{ stroke-dasharray: 2\.6 2\.6; \}/);
    expect(css).toMatch(/\.hud-result \{[^}]*--hud-tone: var\(--brand-b\);/);
  });

  it('cuts the hull, rim, halo and meter from one shuttle outline, which Settings previews', () => {
    const shuttleCss = readFileSync('src/styles/hud-shuttle.css', 'utf8');
    expect(shuttleCss.split(`d='${SHUTTLE_PATH}'`)).toHaveLength(4);
    for (const layer of ['hull', 'rim', 'band']) {
      expect(shuttleCss).toMatch(new RegExp(`mask: var\\(--shuttle-${layer}\\) center / 100% 100% no-repeat;`));
    }
    expect(readFileSync('src/styles/hud.css', 'utf8'))
      .toMatch(/\.recording--overlay \.wave \{[^}]*mask: var\(--shuttle-hull\) center \/ 100% 100% no-repeat;/);
    const { container } = render(<ShuttleGlyph />);
    const glyph = container.querySelector('svg.shuttle-glyph')!;
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
    expect(glyph.querySelector(`path[d="${SHUTTLE_PATH}"]`)).not.toBeNull();
    expect(glyph.querySelectorAll('.wave__strand').length).toBeGreaterThanOrEqual(3);
  });

  it('stops every decorative animation and transition under Reduce Motion', () => {
    const css = readFileSync('src/styles/hud-shuttle.css', 'utf8');
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.hud-shuttle,\s*\.hud-shuttle \* \{\s*animation: none;\s*transition: none;\s*will-change: auto;/);
    expect(readFileSync('src/styles/hud.css', 'utf8')).toMatch(/\.hud-payout \{ animation: none; opacity: \.7; \}/);
  });
});
