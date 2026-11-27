import { useState } from 'react';

interface Props {
  /** Open in narrow windows too: with no words yet, the guide is the page. */
  empty: boolean;
  /** One of your own words and a form the matcher replaces with it. */
  example?: { heard: string; word: string };
}

const FALLBACK = { heard: 'vox loom', word: 'Voxloom' };
/** Beside the list there's room to keep it open; under it, the list comes first. */
const besideList = () => typeof matchMedia !== 'function' || matchMedia('(min-width: 960px)').matches;

/**
 * What saving a word does, in plain words (ui-iter-35). Replaces the word
 * specimen and the sentence proof: one always-on fix, then two helpers.
 * Keep the claims in step with docs/models.md § "Word dictionary". It opens
 * once per visit as the layout suits and then stays as the user leaves it.
 */
export function DictionaryGuide({ empty, example = FALLBACK }: Props) {
  const [open] = useState(() => empty || besideList());
  return (
    <details className="dictionary-guide" open={open}>
      <summary className="dictionary-guide__title">What adding a word does</summary>
      <ol className="guide-steps">
        <li>
          <strong>Writes it your way</strong>
          <span>If it comes out in lowercase or split apart, Voxloom writes it the way you saved it.</span>
          <span className="guide-fix">
            <span className="sr-only">For example, </span>
            <span className="guide-fix__heard" dir="auto">{example.heard}</span>
            <span className="sr-only"> becomes </span>
            <i aria-hidden="true" className="guide-fix__thread" />
            <span className="guide-fix__word" dir="auto">{example.word}</span>
          </span>
        </li>
        <li>
          <strong>Helps Whisper hear it</strong>
          <span>If you use Whisper, your newest words are passed to it as a hint.</span>
        </li>
        <li>
          <strong>Guides cleanup</strong>
          <span>When cleanup is on, it can fix a near miss, such as one wrong letter.</span>
        </li>
      </ol>
      <p className="dictionary-guide__foot">
        Words that only sound alike aren’t swapped automatically. To check a mistake you’ve seen, type it when you add a word. Your words stay on this Mac.
      </p>
    </details>
  );
}
