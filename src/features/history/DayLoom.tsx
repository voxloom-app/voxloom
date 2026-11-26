import { type CSSProperties, useId } from 'react';
import { type LoomLayout, weftPath } from './historyLoom';

interface Props {
  /** The timeline row under the pointer or focus; its knot lights up. */
  active?: string | null;
  layout: LoomLayout;
  /** Ids the search and filter still show; the other knots fade. */
  matches: ReadonlySet<string>;
}

/**
 * The History masthead's day loom: two threads twist through the day and tie a
 * knot at every dictation, sized by how long you spoke and coloured by what
 * happened to the words. Today's threads run on to "now", then hang loose.
 * Decorative: the tally and the timeline below carry the same facts as text.
 */
export function DayLoom({ active = null, layout, matches }: Props) {
  const id = useId().replace(/:/g, '');
  const xs = layout.knots.map((knot) => knot.x * 10);
  const end = layout.now === null ? (xs.at(-1) ?? 0) : layout.now * 10;
  const empty = !layout.knots.length;
  return (
    <div aria-hidden="true" className="day-loom" data-empty={empty || undefined}>
      <div className="day-loom__track">
        <svg className="day-loom__weave" focusable="false" preserveAspectRatio="none" viewBox="0 0 1000 48">
          <defs>
            <linearGradient gradientUnits="userSpaceOnUse" id={`${id}-a`} x1="0" x2="1000" y1="0" y2="0">
              <stop offset="0" style={{ stopColor: 'var(--brand-a)' }} />
              <stop offset="1" style={{ stopColor: 'var(--brand-b)' }} />
            </linearGradient>
            <linearGradient gradientUnits="userSpaceOnUse" id={`${id}-b`} x1="0" x2="1000" y1="0" y2="0">
              <stop offset="0" style={{ stopColor: 'var(--brand-b)' }} />
              <stop offset="1" style={{ stopColor: 'var(--brand-a)' }} />
            </linearGradient>
          </defs>
          {empty ? (
            <path className="day-loom__loose" d="M0 24 H1000" />
          ) : (
            <>
              <path className="day-loom__warp" d={`M0 24 H${end.toFixed(1)}`} />
              {([1, -1] as const).map((side, index) => {
                const d = weftPath(xs, side, end);
                return (
                  <g key={side} stroke={`url(#${id}-${index ? 'b' : 'a'})`} style={{ '--i': index } as CSSProperties}>
                    <path className="day-loom__weft" d={d} />
                    <path className="day-loom__pulse" d={d} pathLength={100} />
                  </g>
                );
              })}
              {layout.now !== null && <path className="day-loom__loose" d={`M${end.toFixed(1)} 24 H1000`} />}
            </>
          )}
        </svg>
        {layout.knots.map((knot) => (
          <i
            className="day-loom__knot"
            data-active={knot.id === active || undefined}
            data-match={matches.has(knot.id) ? undefined : 'false'}
            data-newest={knot.newest || undefined}
            data-record={knot.id}
            data-status={knot.status}
            key={knot.id}
            style={{ '--knot': `${knot.size}px`, left: `${knot.x}%` } as CSSProperties}
          />
        ))}
        {layout.now !== null && (
          <span className="day-loom__now" style={{ left: `${layout.now}%` }}>Now</span>
        )}
        {empty && <span className="day-loom__waiting">Waiting for your first words</span>}
      </div>
      {layout.ticks.length > 0 && (
        <ol className="day-loom__ticks">
          {layout.ticks.map((tick) => (
            <li key={tick.x} style={{ left: `${tick.x}%` }}>{tick.label}</li>
          ))}
        </ol>
      )}
    </div>
  );
}
