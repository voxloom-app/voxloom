import { useMemo, useState } from 'react';
import { replaceDictionaryTerms } from '../../services/dictionary/replace';
import { proofSegments } from './spellingForms';

/** Enough for a dictated sentence; keeps the per-keystroke diff trivially small. */
const MAX_PROOF = 240;

interface Props {
  /** Opens on the user's own words; replaced by whatever they type. */
  sample: string;
  words: readonly string[];
}

/**
 * The Dictionary stage's proof: type a sentence the way it might be heard and
 * see what Voxloom types, through the same deterministic match every dictation
 * runs. Each restored stretch is knotted, with what was heard hanging beneath.
 * Nothing typed here is saved.
 */
export function SpellingProof({ sample, words }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  const heard = draft ?? sample;
  const typed = useMemo(() => replaceDictionaryTerms(heard, words), [heard, words]);
  const segments = useMemo(() => proofSegments(heard, typed), [heard, typed]);
  const restored = segments.filter((segment) => segment.kind === 'catch').length;
  const empty = !heard.trim();
  const summary = empty ? '' : restored ? `${restored} restored` : 'Nothing to restore';

  return (
    <div className="proof" data-restored={restored}>
      {/* The visible label stays the click target; browsers would space a hidden suffix ("Heard : …"). */}
      <label className="proof__label proof__label--heard" htmlFor="dictionary-proof">Heard</label>
      <input
        aria-describedby="dictionary-proof-typed"
        aria-label="Heard: try a sentence"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        className="proof__heard"
        id="dictionary-proof"
        maxLength={MAX_PROOF}
        onChange={(event) => setDraft(event.target.value)}
        placeholder="Type a sentence the way it might be heard"
        spellCheck={false}
        type="text"
        value={heard}
      />
      <span aria-hidden="true" className="proof__label proof__label--typed">Typed</span>
      <p className="proof__typed" data-empty={empty || undefined} id="dictionary-proof-typed">
        <span className="sr-only">Voxloom types: </span>
        {empty ? 'Your spellings appear here.' : segments.map((segment, index) => segment.kind === 'text'
          ? <span key={index}>{segment.text}</span>
          : (
            <span className="proof__catch" key={index}>
              <mark className="proof__knot">{segment.typed}</mark>
              <span aria-hidden="true" className="proof__was">{segment.heard}</span>
              <span className="sr-only"> (heard as {segment.heard})</span>
            </span>
          ))}
      </p>
      <p className="proof__note">
        <strong aria-live="polite" className="proof__count">{summary}</strong>
        <span>The same match runs on every dictation, with or without cleanup. Nothing typed here is saved.</span>
      </p>
    </div>
  );
}
