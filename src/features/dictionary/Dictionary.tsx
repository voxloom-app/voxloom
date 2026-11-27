import { useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/Icon';
import { IconButton } from '../../components/IconButton';
import { SearchField } from '../../components/SearchField';
import { SegmentedControl } from '../../components/SegmentedControl';
import { SpellingProof } from './SpellingProof';
import { WordSpecimen } from './WordSpecimen';
import { formsByWord, sampleSentence } from './spellingForms';
import { WordDialog } from './WordDialog';
import { sortedWords } from '../../services/dictionary/format';

const count = (n: number) => `${n} ${n === 1 ? 'word' : 'words'}`;
const views = [
  { value: 'specimen', label: 'Word specimen' },
  { value: 'sentence', label: 'Sentence proof' },
] as const;

/**
 * The alphabetical index selects a spelling for the specimen plate. Auditioning
 * one of its verified forms uses the sentence proof without replacing a draft.
 */
export function Dictionary() {
  const { dictionary, state } = useApp();
  const [editing, setEditing] = useState<string>();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'specimen' | 'sentence' | 'variant'>('specimen');
  const [variant, setVariant] = useState('');
  const [picked, setPicked] = useState<string>();
  const [draft, setDraft] = useState<string | null>(null);
  const proofInput = useRef<HTMLInputElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const alphabetical = useMemo(() => sortedWords(state.words), [state.words]);
  const words = alphabetical.filter((word) =>
    word.toLowerCase().includes(query.toLowerCase())
  );
  const selected = picked && words.includes(picked) ? picked : query ? words[0] : state.words.at(-1);
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
              Select a spelling below to see how Voxloom restores it in a dictation.
            </p>
          </div>
          <button className="btn primary" onClick={(event) => edit(undefined, event.currentTarget)} type="button">
            <Icon name="plus" /> Add term
          </button>
        </div>
        <div className="dictionary-views">
          <SegmentedControl
            label="Spelling view" onChange={setView} options={views} size="sm"
            value={view === 'variant' ? 'sentence' : view}
          />
          {view === 'variant' && (
            <button className="link-button" onClick={() => { setView('sentence'); proofInput.current?.focus(); }} type="button">
              {draft === null ? 'Use sample sentence' : 'Return to my sentence'}
            </button>
          )}
        </div>
        {view !== 'specimen' ? (
          <SpellingProof
            focusOnOpen={view === 'variant'} heard={view === 'variant' ? variant : draft ?? sample}
            inputRef={proofInput} onChange={view === 'variant' ? setVariant : setDraft} words={state.words}
          />
        ) : selected && (
          <WordSpecimen
            forms={forms.get(selected) ?? []} index={alphabetical.indexOf(selected) + 1}
            total={alphabetical.length} word={selected}
            onTest={(form) => { setVariant(form); setView('variant'); }}
          />
        )}
      </header>
      <div className="cloth">
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
            <div className="term-row" data-selected={view === 'specimen' && selected === word || undefined} key={word} role="listitem">
              <button
                aria-label={`Inspect ${word}`} aria-pressed={view === 'specimen' && selected === word}
                className="term-row__inspect" onClick={() => { setPicked(word); setView('specimen'); }} type="button"
              >
                <strong>{word}</strong>
              </button>
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
      </div>
      {open && (
        <WordDialog
          editing={editing}
          onClose={() => setOpen(false)}
          onSave={(word, previous) => {
            dictionary.save(word, previous);
            setPicked(word);
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
