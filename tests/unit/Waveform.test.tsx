import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Waveform, toDisplayLevel } from '../../src/components/Waveform';

describe('Listening meter', () => {
  it('shows measured history, oldest first, with a visible baseline and no fake speech', () => {
    const { rerender } = render(<Waveform levels={[0, 0, 0]} />);
    const nodes = () => [...screen.getByRole('img', { name: 'Microphone level' }).querySelectorAll('i')];
    const baseline = nodes()[0].style.transform;
    expect(nodes().every(node => node.style.transform === baseline)).toBe(true);
    rerender(<Waveform levels={[0, .4, 1]} />);
    expect(nodes()[0].style.transform).toBe(baseline);
    expect(nodes()[1].style.transform).not.toBe(baseline);
    expect(nodes()[2].style.transform).toBe('scaleY(1)');
  });

  it('gates noise, lifts conversation and leaves headroom instead of pinning loud speech', () => {
    for (const level of [0, .0001, Number.NaN, Infinity, -2]) expect(toDisplayLevel(level)).toBe(0);
    const values = [.005, .02, .1, .2, .5, .9, 1].map(toDisplayLevel);
    values.slice(1).forEach((value, i) => expect(value).toBeGreaterThan(values[i]));
    expect(toDisplayLevel(.02)).toBeGreaterThan(.3);
    expect(toDisplayLevel(99)).toBe(1);
  });
});
