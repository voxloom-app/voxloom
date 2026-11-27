import { useMemo, useRef, useState } from 'react';
import { useApp } from '../../app/AppContext';
import { Icon } from '../../components/Icon';
import { newestFirst, sortedWords } from '../../services/dictionary/format';
import { DictionaryGuide } from './DictionaryGuide';
import { WordDialog } from './WordDialog';
import { WordIndex } from './WordIndex';
import { formsByWord } from './spellingForms';

/**
 * The page is your word list (ui-iter-35). Its facing page says, in plain
 * words, what saving a word does; checking a mistake lives in the Add sheet.
 */
export function Dictionary() {
  const { dictionary, state } = useApp();
  const [editing, setEditing] = useState<string>();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [saved, setSaved] = useState<string>();
  const opener = useRef<HTMLElement | null>(null);
  const alphabetical = useMemo(() => sortedWords(state.words), [state.words]);
  const forms = useMemo(() => formsByWord(state.words), [state.words]);
  const example = useMemo(() => {
    const word = newestFirst(state.words).find((candidate) => forms.get(candidate)?.length);
    return word ? { heard: forms.get(word)![0], word } : undefined;
  }, [state.words, forms]);
  const needle = query.trim().toLowerCase();
  const words = alphabetical.filter((word) => word.toLowerCase().includes(needle)
    || forms.get(word)?.some((form) => form.includes(needle)));

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
            <p className="dictionary-stage__lede">Words and names you want Voxloom to spell your way.</p>
          </div>
          <button className="btn primary" onClick={(event) => edit(undefined, event.currentTarget)} type="button">
            <Icon name="plus" /> Add a word
          </button>
        </div>
      </header>
      <div className="page-body dictionary-book">
        <WordIndex
          forms={forms} onDelete={(word) => dictionary.delete(word)} onEdit={edit}
          onQuery={setQuery} query={query} saved={saved} total={alphabetical.length} words={words}
        />
        <DictionaryGuide empty={!state.words.length} example={example} />
      </div>
      {open && (
        <WordDialog
          editing={editing} onClose={() => setOpen(false)}
          onSave={(word, previous) => {
            dictionary.save(word, previous);
            setSaved(word);
            setOpen(false);
          }}
          opener={opener.current} words={state.words}
        />
      )}
    </section>
  );
}
