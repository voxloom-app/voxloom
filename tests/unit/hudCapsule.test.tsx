import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { HudPreview } from '../../src/components/HudPreview';
import { WAVEFORM_SAMPLES } from '../../src/components/Waveform';
import { OverlayWaveformView } from '../../src/overlay/OverlayWaveformView';

describe('HUD signal well', () => {
  it('keeps a mic visible in silence and exchanges it for lines of text when recording stops', () => {
    const { container, rerender } = render(<OverlayWaveformView levels={[]} waveform="silent" />);
    const signal = container.querySelector('.hud-signal');
    expect(signal?.querySelector('[data-icon="mic"]')).not.toBeNull();
    expect(signal).toHaveAttribute('aria-hidden', 'true');
    rerender(<OverlayWaveformView levels={[]} waveform="processing" />);
    expect(container.querySelector('.hud-signal')).toBe(signal);
    expect(signal?.querySelector('[data-icon="mic"]')).toBeNull();
    expect(signal?.querySelector('.hud-writing-line')).not.toBeNull();
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.querySelector('.hud-label')).toHaveTextContent('Transcribing');
  });

  it.each([
    ['result-copied', 'circle.knot__core'], ['result-unverified', 'path.knot__core'], ['result-failed', 'circle.knot__fray'],
  ] as const)('ties a distinct knot for %s', (waveform, shape) => {
    const { container } = render(<OverlayWaveformView levels={[]} waveform={waveform} />);
    expect(container.querySelector(`.hud-knot ${shape}`)).not.toBeNull();
  });

  it('uses the real signal and bars for the still preview without exposing another live meter', () => {
    const { container } = render(<HudPreview />);
    expect(container.querySelector('.hud-signal [data-icon="mic"]')).not.toBeNull();
    expect(container.querySelectorAll('.wave i')).toHaveLength(WAVEFORM_SAMPLES);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });
});
