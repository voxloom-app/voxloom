interface Props {
  forms: readonly string[];
  index: number;
  total: number;
  word: string;
  onTest: (form: string) => void;
}

/** A proof plate for a single saved spelling. Ink the capitals separately so
 * the details that don't come through in speech are easy to spot. */
export function WordSpecimen({ forms, index, total, word, onTest }: Props) {
  const number = (value: number) => String(value).padStart(2, '0');
  // Valid entries are unbounded. Don't make thousands of spans for a long one.
  const type = word.length > 80 ? word : word.split(/(\p{Lu}+)/u).map((run, i) =>
    i % 2 ? <b key={i}>{run}</b> : run);
  return (
    <section aria-label="Saved spelling specimen" className="word-specimen" id="word-specimen">
      <div className="specimen-plate">
        <div className="specimen-plate__legend">
          <span>Saved spelling</span>
          <span><span className="sr-only">Entry </span>{number(index)} / {number(total)}</span>
        </div>
        <div className="specimen-plate__measure" data-length={word.length > 20 ? 'long' : word.length > 11 ? 'medium' : 'short'}>
          <h2 aria-label={word} className="specimen-plate__word" dir="auto" tabIndex={0}>{type}</h2>
        </div>
        <div aria-hidden="true" className="specimen-plate__rule" />
      </div>
      <div className="specimen-variants">
        <p className="specimen-variants__title">Test a heard form</p>
        {forms.length ? forms.map((form) => (
          <button aria-label={`Test ${form}`} key={form} onClick={() => onTest(form)} type="button">
            <span dir="auto">{form}</span><i aria-hidden="true">↗</i>
          </button>
        )) : <p className="specimen-variants__empty">No example variants.</p>}
      </div>
    </section>
  );
}
