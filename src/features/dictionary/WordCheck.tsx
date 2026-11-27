import { useMemo } from 'react';
import { replaceDictionaryTerms } from '../../services/dictionary/replace';
import { proofSegments } from './spellingForms';

/** Enough for a dictated sentence; keeps the per-keystroke diff trivially small. */
const MAX_CHECK = 240;

interface Props {
  heard: string;
  onChange: (value: string) => void;
  placeholder: string;
  /** The word being added or edited, trimmed and valid, or ''. */
  word: string;
  /** The dictionary as it will be once this word is saved. */
  words: readonly string[];
}

/**
 * "What does Voxloom write instead?" (ui-iter-35, was the sentence proof):
 * type a mistake you've seen and preview what Voxloom writes once this word
 * is saved, through the same deterministic match every dictation runs. Each
 * replaced stretch is marked, with what you typed hanging beneath. Only the
 * word is saved; this text never is.
 */
export function WordCheck({ heard, onChange, placeholder, word, words }: Props) {
  const typed = useMemo(() => replaceDictionaryTerms(heard, words), [heard, words]);
  const segments = useMemo(() => proofSegments(heard, typed), [heard, typed]);
  const fixed = segments.some((segment) => segment.kind === 'catch');
  const empty = !heard.trim();
  const verdict = empty ? ''
    : fixed ? 'Fixed: Voxloom will write it like this.'
      : word && heard.trim() === word ? 'That’s already your spelling.'
        : 'Not changed by spelling alone. Whisper or cleanup may still catch it.';

  return (
    <div className="word-check" data-state={empty ? 'empty' : fixed ? 'fixed' : 'unchanged'}>
      <label htmlFor="dictionary-heard">
        What does Voxloom write instead? <span className="word-check__optional">Optional</span>
      </label>
      <input
        aria-describedby="dictionary-heard-preview"
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        id="dictionary-heard"
        maxLength={MAX_CHECK}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        type="text"
        value={heard}
      />
      <div className="word-check__preview" id="dictionary-heard-preview">
        <span aria-hidden="true" className="word-check__label">Preview</span>
        <p className="word-check__typed" data-empty={empty || undefined}>
          <span className="sr-only">Preview: </span>
          {empty ? 'Type a mistake you’ve seen to check how Voxloom will write it.' : segments.map((segment, index) => segment.kind === 'text'
            ? <span key={index}>{segment.text}</span>
            : (
              <span className="word-check__catch" key={index}>
                <mark className="word-check__fix">{segment.typed}</mark>
                <span aria-hidden="true" className="word-check__was">{segment.heard}</span>
                <span className="sr-only"> (replaces {segment.heard})</span>
              </span>
            ))}
        </p>
        <span aria-live="polite" className="word-check__verdict">{verdict}</span>
      </div>
      <p className="word-check__note">Only the word is saved. This preview isn’t.</p>
    </div>
  );
}
