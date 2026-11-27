import type { Ref } from 'react';
import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import { SearchField } from '../../components/SearchField';

interface Props {
  words: readonly string[];
  total: number;
  query: string;
  selected?: string;
  selectedRef: Ref<HTMLButtonElement>;
  onQuery: (query: string) => void;
  onInspect: (word: string) => void;
  onEdit: (word: string, opener: HTMLElement) => void;
  onDelete: (word: string) => void;
}

const initial = (word: string) => String.fromCodePoint(word.codePointAt(0)!).toLocaleUpperCase();

/** A thumb letter starts each run of spellings. The facing page owns the examples. */
export function WordIndex({ words, total, selected, selectedRef, query, onQuery, onInspect, onEdit, onDelete }: Props) {
  const count = `${total} ${total === 1 ? 'word' : 'words'}`;
  return (
    <section aria-labelledby="word-index-title" className="word-index">
      <div className="word-index__head">
        <h2 id="word-index-title">Word index</h2>
        <span aria-live="polite" className="fine">{query ? `${words.length} of ${count}` : count}</span>
        <SearchField label="Search dictionary" onChange={onQuery} placeholder="Spelling or heard form" value={query} />
      </div>
      <div aria-label={words.length ? 'Dictionary words, alphabetical' : undefined} className="term-grid" role={words.length ? 'list' : undefined}>
        {words.map((word, i) => (
          <div className="term-row" data-selected={selected === word || undefined} key={word} role="listitem">
            <button
              aria-label={`Inspect ${word}`} aria-pressed={selected === word}
              className="term-row__inspect" onClick={() => onInspect(word)}
              ref={selected === word ? selectedRef : undefined} type="button"
            >
              <span aria-hidden="true" className="term-row__initial">
                {i === 0 || initial(words[i - 1]) !== initial(word) ? initial(word) : null}
              </span>
              <strong dir="auto">{word}</strong>
            </button>
            <div className="action-group term-row__actions">
              <IconButton icon="edit" label={`Edit ${word}`} onClick={(event) => onEdit(word, event.currentTarget)} />
              <IconButton icon="trash" label={`Delete ${word}`} onClick={() => onDelete(word)} tone="danger" />
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
          <abbr title="Alphabetical order">A–Z</abbr>
        </div>
      )}
    </section>
  );
}
