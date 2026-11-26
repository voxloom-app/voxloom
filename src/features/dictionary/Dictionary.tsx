import { useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { SearchField } from '../../components/SearchField';
import { SpellingProof } from './SpellingProof';
import { formsByWord, sampleSentence } from './spellingForms';
import { WordDialog } from './WordDialog';
import { sortedWords } from '../../services/dictionary/format';

const count = (n: number) => `${n} ${n === 1 ? 'word' : 'words'}`;

/**
 * Dictionary as a spelling loom (ui-iter-05): a dark stage masthead (the Home
 * stage's material) proofs a sentence through the real spelling match, and
 * every saved spelling lists the heard forms it restores.
 */
export function Dictionary() {
  const { dictionary, state } = useApp();
  const [editing, setEditing] = useState<string>();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const opener = useRef<HTMLElement | null>(null);
  const words = sortedWords(state.words).filter((word) =>
    word.toLowerCase().includes(query.toLowerCase())
  );
  const forms = useMemo(() => formsByWord(state.words), [state.words]);
  const sample = useMemo(() => sampleSentence(state.words, forms), [state.words, forms]);

  function edit(word: string | undefined, element: HTMLElement) {
    opener.current = element;
    setEditing(word);
    setOpen(true);
  }

  return (
    <section aria-labelledby="dictionary-title" className="dictionary">
      <header className="stage dictionary-stage">
        <div className="dictionary-stage__top">
          <div className="dictionary-stage__title">
            <h1 id="dictionary-title">Dictionary</h1>
            <p className="dictionary-stage__lede">
              Your canonical spellings for names and terms, restored in every dictation even
              when a word is heard in lowercase or split apart.
            </p>
          </div>
          <button className="btn primary" onClick={(event) => edit(undefined, event.currentTarget)} type="button">
            <Icon name="plus" /> Add term
          </button>
        </div>
        <SpellingProof sample={sample} words={state.words} />
      </header>
      <div className="history-tools">
        <SearchField label="Search dictionary" onChange={setQuery} placeholder="Search words" value={query} />
        <span aria-live="polite" className="fine">
          {query ? `${words.length} of ${count(state.words.length)}` : count(state.words.length)}
        </span>
      </div>
      <div className="dictionary-list-head">
        <span>
          Canonical spelling
          <span className="dictionary-list-sort">A–Z <span aria-hidden="true">↓</span></span>
        </span>
        <span className="dictionary-list-from">Restored from</span>
      </div>
      <div aria-label={words.length ? 'Dictionary words, alphabetical' : undefined} className="term-grid" role={words.length ? 'list' : undefined}>
        {words.map((word) => (
          <div className="term-row" key={word} role="listitem">
            <strong>{word}</strong>
            <TermForms forms={forms.get(word) ?? []} />
            <div className="action-group term-row__actions">
              <IconButton icon="edit" label={`Edit ${word}`} onClick={(event) => edit(word, event.currentTarget)} />
              <IconButton icon="trash" label={`Delete ${word}`} onClick={() => dictionary.delete(word)} tone="danger" />
            </div>
          </div>
        ))}
        {!words.length && (
          <EmptyState icon="book" title={query ? 'No words found.' : 'No words yet'}>
            {query ? 'Try another search.' : 'Add names and terms you use often.'}
          </EmptyState>
        )}
      </div>
      {words.length > 0 && (
        <div className="dictionary-list-foot">
          <span>{words[0]} — {words[words.length - 1]}</span>
          <span>Alphabetical order</span>
        </div>
      )}
      {open && (
        <WordDialog
          editing={editing}
          onClose={() => setOpen(false)}
          onSave={(word, previous) => {
            dictionary.save(word, previous);
            setOpen(false);
          }}
          opener={opener.current}
          words={state.words}
        />
      )}
    </section>
  );
}

/** The heard forms a spelling restores, hung on the row's thread; plain text, never a tab stop. */
function TermForms({ forms }: { forms: readonly string[] }) {
  if (!forms.length) return <span className="term-row__forms" data-empty="true" />;
  return (
    <span className="term-row__forms">
      <span className="term-row__list">
        <span className="sr-only">, restored from </span>
        {forms.map((form, index) => (
          <span className="term-row__form" key={form}>
            {index > 0 && <span className="sr-only">, </span>}
            {form}
          </span>
        ))}
      </span>
    </span>
  );
}
