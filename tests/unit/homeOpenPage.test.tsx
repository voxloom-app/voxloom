import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { act, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useApp } from '../../src/app/AppContext';
import type { DictationRecord } from '../../src/domain/types';
import { unverifiedDay } from '../../src/dev/ScenarioPanel';
import { Home } from '../../src/features/home/Home';
import { knotKey } from '../../src/features/home/pickWords';
import type { UseDogfoodCaptureResult } from '../../src/services/stt/useDogfoodCapture';
import { renderWithApp } from './testUtils';

const css = (name: string) => readFileSync(join(__dirname, '../../src/styles', name), 'utf8');
// Local early afternoon, so the fixture's runs fall on one local day in any time zone.
const NOON = () => new Date(2026, 10, 26, 14).getTime();

const dogfood = (): UseDogfoodCaptureResult => ({
  cancel: vi.fn(), captureState: { kind: 'idle' }, hudResult: null, intendedTarget: null, message: null,
  origin: null, phase: 'idle', scopeReady: false, hudReady: false, start: vi.fn().mockResolvedValue(undefined),
  stop: vi.fn().mockResolvedValue(undefined), transcript: null,
});

/** Home on a day when every delivery came back Unverified (the current main-branch bug). */
function renderUnverifiedHome(count = 38) {
  let api: ReturnType<typeof useApp> | null = null;
  function Probe() { api = useApp(); return null; }
  renderWithApp(<><Probe /><Home dogfood={dogfood()} onToast={vi.fn()} /></>, NOON);
  act(() => {
    api!.dispatch({ type: 'scenario-empty' });
    unverifiedDay(NOON(), count).forEach((record) => api!.dispatch({ record, type: 'append-record' }));
  });
}

const record = (status: DictationRecord['status'], id: string): DictationRecord => ({
  createdAt: NOON(), durationSeconds: 3, id, model: null, recoveryExpiresAt: null, status, style: 'formal', text: 'Synthetic.',
});

describe('Home opens into one page (ui-iter-29)', () => {
  it('names an all-Unverified list once, in the key, with no pill on any row', () => {
    renderUnverifiedHome();
    const list = screen.getByRole('region', { name: 'Earlier dictations' });
    const rows = list.querySelectorAll('.recent-row');
    expect(rows).toHaveLength(5);
    for (const row of rows) {
      expect(row).toHaveAttribute('data-status', 'unverified');
      expect(row.querySelector('.badge')).toBeNull();
      // Screen readers still hear each row's status.
      expect(within(row as HTMLElement).getByText('Unverified')).toHaveClass('sr-only');
    }
    const keys = list.querySelectorAll('.earlier__key');
    expect(keys).toHaveLength(1);
    expect(keys[0]).toHaveTextContent('5 unverified · Couldn’t confirm they were typed.');
    // The knot in the key is decoration; the words carry the meaning.
    expect(keys[0].querySelector('i')).toHaveAttribute('aria-hidden', 'true');
  });

  it('uses the singular when only one earlier dictation is unverified', () => {
    renderUnverifiedHome(2);
    expect(document.querySelectorAll('.home .recent-row')).toHaveLength(1);
    expect(document.querySelector('.earlier__key')).toHaveTextContent('1 unverified · Couldn’t confirm it was typed.');
  });

  it('shows no key when nothing hangs under the stage', () => {
    renderUnverifiedHome(1);
    expect(screen.getByText('Nothing earlier yet.')).toBeInTheDocument();
    expect(document.querySelector('.earlier__key')).toBeNull();
  });

  it('counts the key unverified first, then copied, then inserted, skipping absent outcomes', () => {
    const records = [record('inserted', 'a'), record('copied', 'b'), record('unverified', 'c'), record('inserted', 'd')];
    expect(knotKey(records)).toEqual([
      { count: 1, status: 'unverified' },
      { count: 1, status: 'copied' },
      { count: 2, status: 'inserted' },
    ]);
    expect(knotKey([record('copied', 'e')])).toEqual([{ count: 1, status: 'copied' }]);
    expect(knotKey([])).toEqual([]);
  });

  it('lays the earlier words and the colophon on the open page, not a sheet', () => {
    renderUnverifiedHome();
    const home = document.querySelector('.home')!;
    const page = home.querySelector(':scope > .home-page')!;
    expect(page).not.toBeNull();
    expect(home.querySelector('.cloth')).toBeNull();
    const [earlier, colophon] = [...page.children];
    expect(earlier).toHaveClass('earlier');
    expect(colophon).toHaveClass('home-colophon');
    // The stage ends on the weft: nothing about models or styles sits between the words.
    expect(home.querySelector('.stage .home-colophon, .stage .home-style')).toBeNull();
  });

  it('gives the open page the frame’s linen in light, and the key the list’s own knot shapes', () => {
    expect(css('daylight.css')).toMatch(/:is\(\.stage, \.sidebar, [^)]*, \.main \.home-page\) \{/);
    const page = css('home-page.css');
    const rows = css('home.css');
    // The key's dotted knot matches the rows' unverified knot, so one shape means one thing.
    const dotted = 'border: 2px dotted color-mix(in srgb, var(--warn) 45%, var(--mut));';
    expect(page).toContain(`.earlier__key [data-status="unverified"] i { background: none; ${dotted} }`);
    expect(rows).toContain(dotted);
    expect(page).toContain('.earlier__key [data-status="copied"] i { background: none; box-shadow: inset 0 0 0 2px var(--info); }');
  });
});
