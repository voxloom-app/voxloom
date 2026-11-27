import { EmptyState } from '../../components/EmptyState';
import { IconButton } from '../../components/IconButton';
import { SearchField } from '../../components/SearchField';

interface Props {
  words: readonly string[];
  /** What the real matcher writes back as each word, from `formsByWord`. */
  forms: ReadonlyMap<string, readonly string[]>;
  total: number;
  query: string;
  /** The word saved last, marked until another is saved. */
  saved?: string;
  onQuery: (query: string) => void;
  onEdit: (word: string, opener: HTMLElement) => void;
  onDelete: (word: string) => void;
}

const initial = (word: string) => String.fromCodePoint(word.codePointAt(0)!).toLocaleUpperCase();

/** Your words, A to Z. Each row says what it replaces, so no second page is needed to find out. */
export function WordIndex({ words, forms, total, saved, query, onQuery, onEdit, onDelete }: Props) {
  const count = `${total} ${total === 1 ? 'word' : 'words'}`;
  return (
    <section aria-labelledby="word-index-title" className="word-index">
      <div className="word-index__head">
        <h2 id="word-index-title">Your words</h2>
        <span aria-live="polite" className="fine">{query ? `${words.length} of ${count}` : count}</span>
        <SearchField label="Search dictionary" onChange={onQuery} placeholder="Search your words" value={query} />
      </div>
      <div aria-label={words.length ? 'Dictionary words, alphabetical' : undefined} className="term-grid" role={words.length ? 'list' : undefined}>
        {words.map((word, i) => {
          const replaces = forms.get(word) ?? [];
          return (
            <div className="term-row" data-saved={saved === word || undefined} key={word} role="listitem">
              <div className="term-row__word">
                <span aria-hidden="true" className="term-row__initial">
                  {i === 0 || initial(words[i - 1]) !== initial(word) ? initial(word) : null}
                </span>
                <strong dir="auto">{word}</strong>
                {replaces.length > 0 && (
                  <span className="term-row__replaces">
                    <span className="term-row__verb">replaces </span>
                    <span dir="auto">{replaces.join(', ')}</span>
                  </span>
                )}
              </div>
              <div className="action-group term-row__actions">
                <IconButton icon="edit" label={`Edit ${word}`} onClick={(event) => onEdit(word, event.currentTarget)} />
                <IconButton icon="trash" label={`Delete ${word}`} onClick={() => onDelete(word)} tone="danger" />
              </div>
            </div>
          );
        })}
        {!words.length && (
          <EmptyState icon="book" title={query ? 'No words found.' : 'No words yet'}>
            {query ? 'Try another search.' : 'Add a name or term Voxloom keeps getting wrong, spelled the way you want it.'}
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
