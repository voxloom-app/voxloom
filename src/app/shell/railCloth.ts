import type { DictationRecord, HistoryStatus } from '../../domain/types';

/** Seven warp threads, offsets from the rail's centre where they leave the warp beam. */
export const SPREAD = [-42, -28, -14, 0, 14, 28, 42] as const;
/** How far the threads close in for weaving: the cloth is narrower than the beam. */
const CLOSE = 0.62;
/** Where (in the 0–100 warp box) the threads run parallel, ready for the cloth. */
const PARALLEL_FROM = 58;

/** A thread's x in the cloth, where every pick crosses it. */
export const warpX = (offset: number) => 50 + offset * CLOSE;

/** The cloth runs a little past the outer threads, so each pick turns at a selvedge. */
export const CLOTH = { left: warpX(SPREAD[0]) - 3, right: warpX(SPREAD[6]) + 3 } as const;

/**
 * One warp thread (viewBox 0–100 both ways): from its place across the top of the free
 * space, closing in to run parallel through today's cloth and down to the shuttle at
 * the fell. Small per-thread bends keep the warp from looking ruled.
 */
export function warpPath(offset: number, index: number): string {
  const top = 50 + offset;
  const x = warpX(offset);
  const bend = ((index * 37) % 13) - 6;
  return `M${top} 0 C ${top + bend} 30 ${x} 38 ${x} ${PARALLEL_FROM} L ${x} 100`;
}

export interface Pick {
  id: string;
  status: HistoryStatus;
  /** Centre of the pick, in px from the top of the cloth. */
  y: number;
  /** Thickness in px: a longer dictation lays a heavier pick. */
  h: number;
  /** Which threads it passes over: plain weave alternates every pick. */
  over: 0 | 1;
  newest: boolean;
}

export interface ClothLayout {
  /** Height of the woven cloth in px (0 before the first dictation of the day). */
  height: number;
  picks: Pick[];
}

/** Gap between picks, and the cloth's budget before older picks are beaten tighter. */
const GAP = 2.2;
const BUDGET = 168;
const FELL = 4;

/** A pick's natural thickness for a dictation of `seconds`. */
export const pickHeight = (seconds: number) => Math.min(7.5, Math.max(3, 2 + seconds / 5));

/**
 * Today's cloth: one pick per dictation, oldest at the top, the newest beaten in at the
 * fell just above the shuttle. A busy day packs its picks tighter, so the cloth keeps
 * to its budget.
 */
export function clothLayout(today: readonly DictationRecord[]): ClothLayout {
  const oldestFirst = [...today].sort((a, b) => a.createdAt - b.createdAt);
  if (!oldestFirst.length) return { height: 0, picks: [] };
  const natural = oldestFirst.map((record) => pickHeight(record.durationSeconds));
  const count = oldestFirst.length;
  const woven = natural.reduce((sum, h) => sum + h, 0);
  // Beat the gaps in first (never under 1px), then the picks share what is left. Past
  // ~70 picks the floors win and the oldest roll up under the warp's fade.
  const gap = Math.max(1, GAP * Math.min(1, BUDGET / (woven + GAP * count)));
  const beat = Math.min(1, Math.max(0, BUDGET - gap * count) / woven);
  let y = 0;
  const picks = oldestFirst.map((record, index): Pick => {
    const h = Math.max(1.2, natural[index] * beat);
    const pick: Pick = {
      h: Math.round(h * 100) / 100,
      id: record.id,
      newest: index === count - 1,
      // The newest pick passes over the even threads; each older one alternates.
      over: ((count - 1 - index) % 2) as 0 | 1,
      status: record.status,
      y: Math.round((y + h / 2) * 100) / 100,
    };
    y += h + gap;
    return pick;
  });
  return { height: Math.round((y - gap + FELL) * 100) / 100, picks };
}
