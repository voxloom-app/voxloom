import { useApp } from '../app/AppContext';
import type { DictationRecord } from '../domain/types';

const PHRASES = [
  'Move the sync to Thursday morning.', 'Add a test for the empty state.', 'Thanks, that works for me.',
  'Ship the synthetic sample today.', 'Check the release notes before lunch.', 'Rename the draft to version two.',
];

/** Synthetic: a busy day where no delivery could be confirmed, so every pick shares one status. */
export function unverifiedDay(now: number, count = 38): DictationRecord[] {
  return Array.from({ length: count }, (_, index) => ({
    createdAt: now - (count - index) * 4 * 60_000, durationSeconds: 3 + (index % 9), id: `synthetic-unverified-${now}-${index}`,
    model: null, recoveryExpiresAt: null, status: 'unverified', style: 'formal', text: PHRASES[index % PHRASES.length],
  }));
}

// Multi-paragraph sample for checking excerpt, scrolling and full-text copy in the browser.
const LONG_NOTE = [
  'For the next print run, keep the map on one sheet. Someone standing at the trailhead should be able to find the footbridge without unfolding a second page.',
  'On the west side, the path turns just before the orchard. Mark the turn itself, not the nearest gate. In the afternoon the shadow from the gate makes that junction surprisingly easy to miss.',
  'Leave enough room in the lower margin for the bus timetable. The weekday and weekend services start from different stops, so give each its own line and spell out the stop names.',
  'Finally, take the sample outside. If the smallest labels are still legible at dusk, the map is ready to print.',
].join('\n\n');

interface ScenarioPanelProps {
  onReset: () => void;
}

export function ScenarioPanel({ onReset }: ScenarioPanelProps) {
  const { dictation, dispatch, now, state } = useApp();
  const runId = 'runId' in state.dictation ? state.dictation.runId : null;

  return (
    <section aria-label="Development scenarios" className="state-lab">
      <strong>Dev · mock scenarios</strong>
      <button onClick={onReset}>
        Reset session
      </button>
      <button onClick={onReset}>First-run setup</button>
      <button onClick={() => dispatch({ type: 'scenario-empty' })}>
        Empty lists
      </button>
      <button onClick={() => unverifiedDay(now()).forEach((record) => dispatch({ record, type: 'append-record' }))}>
        38 unconfirmed runs
      </button>
      <button onClick={() => {
        const at = now();
        dispatch({ type: 'append-record', record: {
          createdAt: at, durationSeconds: 62, id: `synthetic-note-${crypto.randomUUID()}`, model: null,
          recoveryExpiresAt: null, status: 'unverified', style: 'formal', text: LONG_NOTE,
        } });
      }}>Long dictation</button>
      <button onClick={dictation.start}>
        Listening · silent
      </button>
      <button onClick={() => {
        dictation.start();
        dictation.speech('speaking');
      }}>Listening · speaking</button>
      <button disabled={runId === null} onClick={() => runId !== null &&
        dictation.holdProcessing(runId)}>Processing</button>
      <button disabled={runId === null} onClick={() => runId !== null &&
        dictation.complete(runId)}>
        Complete success
      </button>
      <button disabled={runId === null} onClick={() => runId !== null &&
        dictation.fail(runId)}>
        Complete error
      </button>
      <button disabled={runId === null} onClick={() => runId !== null &&
        dictation.cancel(runId)}>
        Cancel
      </button>
      <button onClick={() => dispatch({ now: now(), type: 'expire-recovery' })}>
        Expire recovery buffers
      </button>
      <label className="check">
        <input checked={state.clipboardFailure} onChange={(event) => dispatch({
          type: 'set-clipboard-failure',
          value: event.target.checked,
        })} type="checkbox" />
        Copy failure
      </label>
      <p>
        Controls are synthetic. No audio or OS capability is used.
        With durable history on, Reset asks before wiping{' '}
        <code>history.json</code>.
      </p>
    </section>
  );
}
