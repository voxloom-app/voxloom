import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WEAVE, Waveform, toDisplayLevel, weavePath, weaveRuns } from '../../src/components/Waveform';

const quiet = Array(24).fill(0) as number[];
const loud = Array(24).fill(1) as number[];
const row = WEAVE.x1 - WEAVE.x0;

const points = (d: string) => d.slice(1).split(/[LM]/).map((pair) => pair.split(' ').map(Number) as [number, number]);

/** Largest swing from the centre line over part of the row (0 = voice side, 1 = text side). */
function swing(d: string, from = 0, to = 1): number {
  return Math.max(0, ...points(d)
    .filter(([x]) => x >= WEAVE.x0 + from * row && x <= WEAVE.x0 + to * row)
    .map(([, y]) => Math.abs(y - WEAVE.mid)));
}

const strands = (levels: readonly number[]) => [0, 1, 2].map((strand) => weavePath(levels, strand));
const maxSwing = (levels: readonly number[], from?: number, to?: number) =>
  Math.max(...strands(levels).map((d) => swing(d, from, to)));

describe('Waveform (the voice thread)', () => {
  it('renders measured levels instead of a looping mock pattern', () => {
    const { container, rerender } = render(<Waveform levels={quiet} waveform="silent" />);
    expect(screen.getByRole('img')).toHaveAccessibleName('Microphone level');
    for (const strand of [0, 1, 2]) expect(container.querySelector(`.wave__strand--${strand}`)).not.toBeNull();
    const rest = container.innerHTML;
    expect(maxSwing(quiet)).toBeLessThanOrEqual(WEAVE.restAmp);

    // The newest level enters on the voice side and swells the braid there at once.
    const newest = [...quiet.slice(1), 0.6];
    rerender(<Waveform levels={newest} waveform="silent" />);
    expect(container.innerHTML).not.toBe(rest);
    expect(maxSwing(newest, 0, 0.25)).toBeGreaterThan(3);
    expect(maxSwing(newest, 0.75, 1)).toBeLessThanOrEqual(WEAVE.restAmp);

    rerender(<Waveform levels={quiet} waveform="silent" />);
    expect(container.innerHTML).toBe(rest);
  });

  it('carries older levels toward the text side', () => {
    const oldest = [0.9, 0.9, ...quiet.slice(2)];
    expect(maxSwing(oldest, 0.75, 1)).toBeGreaterThan(3);
    expect(maxSwing(oldest, 0, 0.25)).toBeLessThanOrEqual(WEAVE.restAmp);
  });

  it('stays inside the shuttle and leaves it through the eyelets as one thread', () => {
    expect(row).toBe(118);
    expect(maxSwing(loud)).toBeGreaterThan(WEAVE.maxAmp - 0.5);
    for (const d of strands(loud)) {
      const all = points(d);
      expect(all[0]).toEqual([WEAVE.x0, WEAVE.mid]);
      expect(all.at(-1)).toEqual([WEAVE.x1, WEAVE.mid]);
      for (const [, y] of all) expect(Math.abs(y - WEAVE.mid)).toBeLessThanOrEqual(WEAVE.maxAmp);
    }
    // Noise and bad values never push a strand out of the row.
    expect(maxSwing([Number.NaN, 5, -3, ...quiet.slice(3)])).toBeLessThanOrEqual(WEAVE.maxAmp);
  });

  it('splits each strand into back and front runs that rejoin into the whole strand', () => {
    for (const strand of [0, 1, 2]) {
      const { back, front } = weaveRuns(loud, strand);
      expect(back).not.toBe('');
      expect(front).not.toBe('');
      const joined = new Set([...points(back), ...points(front)].map((point) => point.join(',')));
      expect([...joined].sort()).toEqual(points(weavePath(loud, strand)).map((point) => point.join(',')).sort());
    }
  });

  it('gates noise and clamps the volume before display', () => {
    expect(toDisplayLevel(0)).toBe(0);
    expect(toDisplayLevel(0.0001)).toBe(0);
    expect(toDisplayLevel(0.02)).toBeGreaterThan(0);
    expect(toDisplayLevel(0.1)).toBeGreaterThan(toDisplayLevel(0.02));
    expect(toDisplayLevel(99)).toBe(1);
    expect(toDisplayLevel(Number.NaN)).toBe(0);
  });
});
