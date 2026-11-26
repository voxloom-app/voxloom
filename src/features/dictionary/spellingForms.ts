import { replaceDictionaryTerms } from '../../services/dictionary/replace';

/**
 * Dictionary as a spelling loom (ui-iter-05). Everything here is read back
 * through `replaceDictionaryTerms`, the deterministic match every dictation
 * runs, so the page never claims a catch the pipeline would not make.
 */

/** Longer entries get no examples: the row stays one line and the work small. */
const MAX_TERM = 40;
const MAX_FORMS = 3;
const MAX_SAMPLE_TERMS = 3;
const WORD_CHAR = /[\p{L}\p{M}\p{N}_]/u;

const splitAt = (term: string, joiner: string) => term.replace(/(\p{Ll})(\p{Lu})/gu, `$1${joiner}$2`);

/** Ways a saved spelling may come out of the engine: split, lowercase, hyphenated. */
function candidateForms(term: string): string[] {
  const lower = term.toLowerCase();
  const forms = [splitAt(term, ' ').toLowerCase()];
  if (term.includes('-')) forms.push(lower.replaceAll('-', ' '));
  forms.push(lower, splitAt(term, '-').toLowerCase());
  if (term.includes('-')) forms.push(lower.replaceAll('-', ''));
  if (term.includes(' ')) forms.push(lower.replaceAll(' ', '-'));
  return forms;
}

/**
 * Up to three forms of `term` that the real matcher, given the whole
 * dictionary, writes back as `term`. Entries the matcher would not restore
 * (or anything over 40 characters) get none.
 */
export function restoredForms(term: string, words: readonly string[]): string[] {
  if (term.length > MAX_TERM) return [];
  const seen = new Set<string>([term]);
  const forms: string[] = [];
  for (const form of candidateForms(term)) {
    if (seen.has(form)) continue;
    seen.add(form);
    if (replaceDictionaryTerms(form, words) === term) forms.push(form);
    if (forms.length === MAX_FORMS) break;
  }
  return forms;
}

/** Restored forms for every saved spelling, keyed by the spelling. */
export function formsByWord(words: readonly string[]): Map<string, string[]> {
  return new Map(words.map((word) => [word, restoredForms(word, words)]));
}

/**
 * An editable example built from the newest entries' first restored forms,
 * so the proof opens on the user's own words. Empty when nothing would change.
 */
export function sampleSentence(words: readonly string[], forms: ReadonlyMap<string, string[]>): string {
  const heard = [...words].reverse()
    .map((word) => forms.get(word)?.[0])
    .filter((form): form is string => Boolean(form))
    .slice(0, MAX_SAMPLE_TERMS);
  if (!heard.length) return '';
  const last = heard.pop()!;
  return `Follow up on ${heard.length ? `${heard.join(', ')} and ${last}` : last}.`;
}

export type ProofSegment =
  | { kind: 'text'; text: string }
  | { kind: 'catch'; heard: string; typed: string };

interface Token { end: number; start: number; text: string }

/** Words and single punctuation marks, so "script," and "query" align separately. */
const tokens = (text: string): Token[] => Array.from(text.matchAll(/[\p{L}\p{M}\p{N}_]+|[^\s\p{L}\p{M}\p{N}_]/gu), (match) => ({
  end: match.index + match[0].length, start: match.index, text: match[0],
}));

/** Matching token index pairs (longest common subsequence), then an end sentinel. */
function alignment(a: readonly Token[], b: readonly Token[]): [number, number][] {
  const table = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i].text === b[j].text ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const pairs: [number, number][] = [];
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i].text === b[j].text) pairs.push([i++, j++]);
    else if (table[i + 1][j] >= table[i][j + 1]) i += 1;
    else j += 1;
  }
  pairs.push([a.length, b.length]);
  return pairs;
}

/** Widen [start, end) to whole whitespace-separated runs ("Node" → "Node.js"). */
function widen(text: string, start: number, end: number): [number, number] {
  while (start > 0 && /\S/u.test(text[start - 1])) start -= 1;
  while (end < text.length && /\S/u.test(text[end])) end += 1;
  return [start, end];
}

/** Shared punctuation at either end ("postgres," → "Postgres,") stays plain text. */
function trimShared(heard: string, typed: string): [string, string, string, string] {
  let lead = 0;
  while (lead < heard.length && lead < typed.length && heard[lead] === typed[lead] && !WORD_CHAR.test(heard[lead])) lead += 1;
  let tail = 0;
  while (tail < heard.length - lead && tail < typed.length - lead
    && heard.at(-1 - tail) === typed.at(-1 - tail) && !WORD_CHAR.test(heard.at(-1 - tail)!)) tail += 1;
  return [typed.slice(0, lead), heard.slice(lead, heard.length - tail), typed.slice(lead, typed.length - tail), typed.slice(typed.length - tail)];
}

interface Span { heard: [number, number]; typed: [number, number] }

/** The characters between two matched tokens: the changed tokens, or the gap where one side changed nothing. */
function between(text: string, list: readonly Token[], from: number, to: number): [number, number] {
  if (to > from) return [list[from].start, list[to - 1].end];
  return [list[from - 1]?.end ?? 0, list[to]?.start ?? text.length];
}

/** Changed stretches as character ranges in both texts, widened and merged. */
function changedSpans(heard: string, typed: string): Span[] {
  const a = tokens(heard);
  const b = tokens(typed);
  const spans: Span[] = [];
  let nextA = 0;
  let nextB = 0;
  for (const [matchA, matchB] of alignment(a, b)) {
    // A side may change alone, as when "zero copy" only gains a hyphen.
    if (matchA > nextA || matchB > nextB) {
      const span = {
        heard: widen(heard, ...between(heard, a, nextA, matchA)),
        typed: widen(typed, ...between(typed, b, nextB, matchB)),
      };
      const previous = spans.at(-1);
      if (previous && (span.typed[0] < previous.typed[1] || span.heard[0] < previous.heard[1])) {
        previous.heard[1] = Math.max(previous.heard[1], span.heard[1]);
        previous.typed[1] = Math.max(previous.typed[1], span.typed[1]);
      } else spans.push(span);
    }
    nextA = matchA + 1;
    nextB = matchB + 1;
  }
  return spans;
}

/**
 * `typed` split into plain text and the stretches the dictionary changed,
 * each paired with what was heard there. Joining every segment's text (or
 * `typed` for a catch) gives back `typed` exactly.
 */
export function proofSegments(heard: string, typed: string): ProofSegment[] {
  const segments: ProofSegment[] = [];
  const text = (value: string) => {
    if (!value) return;
    const previous = segments.at(-1);
    if (previous?.kind === 'text') previous.text += value;
    else segments.push({ kind: 'text', text: value });
  };
  let cursor = 0;
  for (const span of changedSpans(heard, typed)) {
    const [before, heardPart, typedPart, after] = trimShared(heard.slice(...span.heard), typed.slice(...span.typed));
    text(typed.slice(cursor, span.typed[0]) + before);
    if (heardPart.trim() && typedPart.trim() && heardPart !== typedPart) segments.push({ heard: heardPart, kind: 'catch', typed: typedPart });
    else text(typedPart);
    text(after);
    cursor = span.typed[1];
  }
  text(typed.slice(cursor));
  return segments;
}
