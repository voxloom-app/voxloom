import { type FormEvent, useMemo, useState } from 'react';
import { Dialog } from '../../components/Dialog';
import { validateWord } from '../../domain/dictionary';
import { WordCheck } from './WordCheck';
import { restoredForms } from './spellingForms';

type Props = {
  editing?: string;
  words: string[];
  opener: HTMLElement | null;
  onClose: () => void;
  onSave: (word: string, editing?: string) => void;
};

/**
 * Add/Edit sheet (D5) with inline validation error (D6). Validation is
 * unchanged. Under the word, an optional check previews what Voxloom will
 * write for a mistake you've seen; only the word is saved (ui-iter-35).
 */
export function WordDialog({ editing, words, opener, onClose, onSave }: Props) {
  const [value, setValue] = useState(editing ?? '');
  const [heard, setHeard] = useState('');
  const [error, setError] = useState('');
  const title = editing ? 'Edit dictionary word' : 'Add dictionary word';
  const draft = validateWord(value, words, editing);
  const word = draft.ok ? draft.word : '';
  const others = useMemo(() => words.filter((saved) => saved !== editing), [words, editing]);
  const after = useMemo(() => (word ? [...others, word] : others), [others, word]);
  const example = useMemo(() => (word ? restoredForms(word, after)[0] : undefined), [word, after]);

  function save(event: FormEvent) {
    event.preventDefault();
    if (!draft.ok) {
      setError(draft.error);
      return;
    }
    onSave(draft.word, editing);
  }

  return (
    <Dialog initialFocus="#dictionary-word" label={title} onClose={onClose} opener={opener}>
      <h2>{title}</h2>
      <form className="editor-form" onSubmit={save}>
        <div className="field">
          <label htmlFor="dictionary-word">Word</label>
          <input
            aria-describedby={error ? 'dictionary-word-error' : 'dictionary-word-hint'}
            aria-invalid={error ? true : undefined}
            autoComplete="off"
            id="dictionary-word"
            onChange={(event) => setValue(event.target.value)}
            value={value}
          />
          {error
            ? <p className="form-error" id="dictionary-word-error" role="alert">{error}</p>
            : <p className="field__hint" id="dictionary-word-hint">A word or name, spelled exactly as you want it written.</p>}
        </div>
        <WordCheck
          heard={heard} onChange={setHeard} word={word} words={after}
          placeholder={example ? `For example: ${example}` : 'As it showed up in your text'}
        />
        <div className="editor-actions">
          <button className="btn" onClick={onClose} type="button">Cancel</button>
          <button className="btn primary" type="submit">Save</button>
        </div>
      </form>
    </Dialog>
  );
}
