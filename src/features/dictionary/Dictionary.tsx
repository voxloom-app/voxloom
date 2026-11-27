import { useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useApp } from '../../app/AppContext';
import { Icon } from '../../components/Icon';
import { SegmentedControl } from '../../components/SegmentedControl';
import { sortedWords } from '../../services/dictionary/format';
import { SpellingProof } from './SpellingProof';
import { WordDialog } from './WordDialog';
import { WordIndex } from './WordIndex';
import { WordSpecimen } from './WordSpecimen';
import { formsByWord, sampleSentence } from './spellingForms';

const views = [
  { value: 'specimen', label: 'Word specimen' },
  { value: 'sentence', label: 'Sentence proof' },
] as const;

/** Lookup and proof share a spread. Only verified forms enter the lookup index. */
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
  const heading = useRef<HTMLHeadingElement>(null);
  const indexButton = useRef<HTMLButtonElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const alphabetical = useMemo(() => sortedWords(state.words), [state.words]);
  const forms = useMemo(() => formsByWord(state.words), [state.words]);
  const sample = useMemo(() => sampleSentence(state.words, forms), [state.words, forms]);
  const needle = query.trim().toLowerCase();
  const words = alphabetical.filter((word) => word.toLowerCase().includes(needle)
    || forms.get(word)?.some((form) => form.includes(needle)));
  const selected = picked && words.includes(picked) ? picked : needle ? words[0] : state.words.at(-1);

  function inspect(word: string) {
    // An explicit lookup opens and focuses the entry. Filtering only previews it.
    flushSync(() => { setPicked(word); setView('specimen'); });
    heading.current?.focus();
  }

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
            <p className="dictionary-stage__lede">Your spellings and the ways Voxloom restores them.</p>
          </div>
          <button className="btn primary" onClick={(event) => edit(undefined, event.currentTarget)} type="button">
            <Icon name="plus" /> Add term
          </button>
        </div>
      </header>
      <div className="page-body dictionary-book">
        <WordIndex
          onDelete={(word) => dictionary.delete(word)} onEdit={edit}
          onInspect={inspect} onQuery={setQuery} query={query} selectedRef={indexButton}
          selected={view === 'specimen' ? selected : undefined} total={alphabetical.length} words={words}
        />
        <div className="word-leaf">
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
          ) : selected ? (
            <WordSpecimen
              forms={forms.get(selected) ?? []} headingRef={heading} index={alphabetical.indexOf(selected) + 1}
              onReturn={() => indexButton.current?.focus()}
              total={alphabetical.length} word={selected}
              onTest={(form) => { setVariant(form); setView('variant'); }}
            />
          ) : <p className="word-leaf__blank">{needle ? 'No matching specimen.' : 'Your first spelling will appear here.'}</p>}
        </div>
      </div>
      {open && (
        <WordDialog
          editing={editing} onClose={() => setOpen(false)}
          onSave={(word, previous) => {
            dictionary.save(word, previous);
            setPicked(word);
            setOpen(false);
          }}
          opener={opener.current} words={state.words}
        />
      )}
    </section>
  );
}
