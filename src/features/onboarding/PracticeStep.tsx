import { useState, type ReactNode, type RefObject } from 'react';
import { HudSignal } from '../../components/HudSignal';
import { KeyCombo } from '../../components/KeyCombo';
import type { DogfoodPhase } from '../../services/stt/dogfoodPhase';

/** The note wears the HUD's signals: listening (lime), writing (cyan), then the knot. */
export type PracticeLook = 'idle' | 'listening' | 'writing' | 'done' | 'trouble';

/** `counted`: this way's try is tied off, so a success is this try's, not the last way's. */
export function practiceLook(phase: DogfoodPhase, counted: boolean, hinted: boolean): PracticeLook {
  if (phase === 'starting' || phase === 'recording') return 'listening';
  if (phase === 'transcribing' || phase === 'cleaning') return 'writing';
  if (hinted || phase === 'error') return 'trouble';
  return phase === 'success' && counted ? 'done' : 'idle';
}

const signals = { idle: 'listening', listening: 'listening', writing: 'processing', done: 'ok', trouble: 'warn' } as const;

interface PracticeStepProps {
  heading: RefObject<HTMLHeadingElement | null>;
  field: RefObject<HTMLTextAreaElement | null>;
  mode: 'hold' | 'tap';
  holdDone: boolean;
  tapDone: boolean;
  ready: boolean;
  look: PracticeLook;
  /** The one live status line for this step. */
  status: string;
  busy: boolean;
  /** A try has finished or been refused, so a retry means something. */
  attempted: boolean;
  shortcut: string;
  onRetry: () => void;
  onCheck: () => void;
}

/** Step 3: three beats beside one note. The beats follow the real capture, not a script. */
export function PracticeStep({ heading, field, mode, holdDone, tapDone, ready, look, status, busy, attempted, shortcut, onRetry, onCheck }: PracticeStepProps) {
  const [armed, setArmed] = useState(false);
  const both = holdDone && tapDone;
  const keys = <KeyCombo combo={shortcut} />;
  const beats: ReactNode[] = mode === 'tap'
    ? ['Click in the note.', <>Double-tap {keys}, let go, and speak.</>, 'Press it once more. Your words land in the note.']
    : ['Click in the note.', <>Hold {keys} and say a short sentence.</>, 'Let go. Your words land in the note.'];
  const current = look === 'done' ? 3 : look === 'writing' ? 2 : look === 'listening' || armed ? 1 : 0;
  return <div className="practice" data-armed={armed || undefined} data-look={look} data-mode={mode}>
    <div className="practice__folio">
      <span className="guided-kicker">03 / First words</span><i aria-hidden="true" />
      <div className="guided-modes" aria-label="Two ways to use the same shortcut"><span aria-current={mode === 'hold' ? 'step' : undefined} data-done={holdDone || undefined}>{holdDone ? '✓' : '1'} Hold to talk</span><span aria-current={mode === 'tap' ? 'step' : undefined} data-done={tapDone || undefined}>{tapDone ? '✓' : '2'} Double-tap</span></div>
    </div>
    <div className="practice__spread">
      <div className="practice__task guided-hero">
        <h2 id="guided-heading" ref={heading} tabIndex={-1}>{both ? 'Both ways. All yours.' : mode === 'tap' ? 'Now, go hands-free.' : holdDone ? 'That’s hold to talk.' : 'First, hold to talk.'}</h2>
        <p className="practice__lede">{both ? 'You’ve tried both ways. Use whichever suits the moment.'
          : mode === 'tap' ? 'Hands-free keeps listening after you let go, for longer thoughts.'
            : holdDone ? 'Your words are in the note. Choose Try double-tap for the second way.'
              : 'Say anything. Your words only go into this note.'}</p>
        <ol className="practice__beats">
          {beats.map((beat, index) => <li data-state={index < current ? 'done' : index === current ? 'current' : undefined} key={index}>
            <b aria-hidden="true">{index < current ? '✓' : index + 1}</b><span>{beat}{index < current && <span className="sr-only"> Done.</span>}</span>
          </li>)}
        </ol>
      </div>
      <div className="practice__desk">
        <div className="practice-note">
          <div className="practice-note__head">
            <span>Practice note</span>
            <span className="practice-note__signal"><HudSignal signal={signals[look]} /><span role="status">{status}</span></span>
          </div>
          <textarea aria-label="Practice dictation field" defaultValue="" onBlur={() => setArmed(false)} onFocus={() => setArmed(true)}
            placeholder={mode === 'tap' ? 'Try: Now I can speak hands-free.' : 'Try: My first words with Voxloom.'} ref={field} />
        </div>
        {!ready && <p className="form-error">Check permissions, voice pack and registered shortcut before retrying.</p>}
        <div className="guided-practice-actions">
          {(busy || attempted) && <button className="btn" onClick={onRetry} type="button">{busy ? 'Cancel dictation' : 'Try again'}</button>}
          {!ready && <button className="btn" onClick={onCheck} type="button">Check again</button>}
          <p className="guided-mini">Esc cancels without inserting.</p>
        </div>
      </div>
    </div>
  </div>;
}
