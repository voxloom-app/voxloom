import { type CSSProperties, useId, useState } from 'react';
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
 */
function TodayCloth() {
  const { now, state } = useApp();
  const today = dayKey(now());
  const records = state.records.filter((record) => dayKey(record.createdAt) === today);
  const { height, picks } = clothLayout(records);
  const newest = picks.at(-1)?.id ?? null;
  // The newest pick when the rail mounted; anything newer weaves in.
  const [mountedOn] = useState(() => newest);
  if (!picks.length) return null;
  const width = CLOTH.right - CLOTH.left;
  return (
    <svg
      className="rail-cloth"
      focusable="false"
      preserveAspectRatio="none"
      style={{ height: `${height}px`, left: `${CLOTH.left}%`, width: `${width}%` }}
      viewBox={`${CLOTH.left} 0 ${width} ${height}`}
    >
      {picks.map((pick) => (
        <g
          className="rail-cloth__row"
          data-fresh={pick.newest && pick.id !== mountedOn ? '' : undefined}
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
        </g>
      ))}
    </svg>
  );
}

/**
 * The warp rail's threads: they fill the rail's free space, close in to carry today's
 * cloth and run down to the shuttle docked at the fell. They hold still at rest;
 * `.sidebar[data-phase]` in rail-loom.css sends pulses down them while you speak and
 * back up while Voxloom writes. Pure decoration: the Today card says the same in words.
 */
export function RailWarp() {
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
      <TodayCloth />
    </div>
  );
}
