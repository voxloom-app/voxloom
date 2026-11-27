import { type CSSProperties, useId, useState } from 'react';
import { formatTime } from '../../features/history/HistoryRow';
import { dayKey } from '../../features/history/historyLoom';
import { useApp } from '../AppContext';
import { CLOTH, clothLayout, SPREAD, warpPath, warpX } from './railCloth';

export { warpPath } from './railCloth';

/**
 * Today's cloth (ui-iter-15): every dictation so far today is a pick woven across the
 * warp, oldest at the top and the newest beaten in at the fell, right above the docked
 * shuttle. Plain weave: each pick passes over alternate threads. A longer dictation lays
 * a heavier pick; the dye says what happened to the words, and a failed pick frays into
 * a loose end. A pick that lands while the window is open weaves in once.
 *
 * The cloth can be read (ui-iter-17): point at a pick and its words hang above it, with
 * the time; press it to open that dictation in History. This is a pointer shortcut only:
 * the Today beam above opens the same day from the keyboard, and Recall finds any line.
 */
function TodayCloth({ onShow }: { onShow?: (id: string) => void }) {
  const { now, state } = useApp();
  const today = dayKey(now());
  const records = state.records.filter((record) => dayKey(record.createdAt) === today);
  const { height, picks } = clothLayout(records);
  const newest = picks.at(-1)?.id ?? null;
  // The newest pick when the rail mounted; anything newer weaves in.
  const [mountedOn] = useState(() => newest);
  const [pointed, setPointed] = useState<string | null>(null);
  if (!picks.length) return null;
  const width = CLOTH.right - CLOTH.left;
  const lit = picks.find((pick) => pick.id === pointed);
  const litRecord = lit && records.find((record) => record.id === lit.id);
  return (
    <>
    <svg
      className="rail-cloth"
      focusable="false"
      preserveAspectRatio="none"
      style={{ height: `${height}px`, left: `${CLOTH.left}%`, width: `${width}%` }}
      viewBox={`${CLOTH.left} 0 ${width} ${height}`}
      onPointerLeave={() => setPointed(null)}
    >
      {picks.map((pick) => (
        <g
          className="rail-cloth__row"
          data-fresh={pick.newest && pick.id !== mountedOn ? '' : undefined}
          data-lit={pick.id === pointed ? '' : undefined}
          data-newest={pick.newest ? '' : undefined}
          data-status={pick.status}
          key={pick.id}
        >
          <line
            className="rail-cloth__pick"
            pathLength={100}
            style={{ strokeWidth: pick.h }}
            x1={CLOTH.left + 0.8}
            x2={CLOTH.right - 0.8}
            y1={pick.y}
            y2={pick.y}
          />
          {SPREAD.filter((_, index) => index % 2 === pick.over).map((offset) => (
            <line
              className="rail-cloth__over"
              key={offset}
              x1={warpX(offset)}
              x2={warpX(offset)}
              y1={pick.y - pick.h / 2 - 0.4}
              y2={pick.y + pick.h / 2 + 0.4}
            />
          ))}
          {pick.status === 'failed' && (
            <path
              className="rail-cloth__loose"
              d={`M${CLOTH.right - 0.8} ${pick.y} C ${CLOTH.right + 3} ${pick.y} ${CLOTH.right + 4.5} ${pick.y + 4} ${CLOTH.right + 3.5} ${pick.y + 11}`}
            />
          )}
          {onShow && (
            <line
              className="rail-cloth__hit"
              onClick={() => onShow(pick.id)}
              onPointerEnter={() => setPointed(pick.id)}
              style={{ strokeWidth: Math.max(9, pick.h + 4) }}
              x1={CLOTH.left}
              x2={CLOTH.right}
              y1={pick.y}
              y2={pick.y}
            />
          )}
        </g>
      ))}
    </svg>
    {lit && litRecord && (
      <span className="rail-cloth__read" data-status={lit.status} style={{ bottom: `${height - lit.y + lit.h / 2 + 7}px` }}>
        <time dateTime={new Date(litRecord.createdAt).toISOString()}>{formatTime(litRecord.createdAt)}</time>
        <span className="rail-cloth__words">{litRecord.text}</span>
      </span>
    )}
    </>
  );
}

/**
 * The warp rail's threads: they fill the rail's free space, close in to carry today's
 * cloth and run down to the shuttle docked at the fell. They hold still at rest;
 * `.sidebar[data-phase]` in rail-loom.css sends pulses down them while you speak and
 * back up while Voxloom writes. Since ui-iter-17 they hang from the Today beam above.
 * Decoration for assistive tech: the Today beam says the same in words.
 */
export function RailWarp({ onShow }: { onShow?: (id: string) => void }) {
  const gradient = `vx-warp-${useId().replace(/:/g, '')}`;
  return (
    <div aria-hidden="true" className="rail-warp">
      <svg focusable="false" preserveAspectRatio="none" viewBox="0 0 100 100">
        <defs>
          <linearGradient gradientUnits="userSpaceOnUse" id={gradient} x1="0" x2="0" y1="0" y2="100">
            <stop offset="0" style={{ stopColor: 'var(--brand-a)' }} />
            <stop offset="1" style={{ stopColor: 'var(--brand-b)' }} />
          </linearGradient>
        </defs>
        <g stroke={`url(#${gradient})`}>
          {SPREAD.map((offset, index) => {
            const d = warpPath(offset, index);
            return (
              <g key={offset} style={{ '--i': index } as CSSProperties}>
                <path className="rail-warp__thread" d={d} />
                <path className="rail-warp__pulse" d={d} pathLength={100} />
              </g>
            );
          })}
        </g>
      </svg>
      <TodayCloth onShow={onShow} />
    </div>
  );
}
