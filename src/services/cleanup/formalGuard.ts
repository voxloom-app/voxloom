// BUS-229: the output check for Formal. A real formal rewrite drops fillers,
// expands contractions and rewords, so the in-order word check that Casual
// and Very Casual use (contentGuard.ts) would reject every one and fall back
// to the raw text. Formal checks facts instead: negation and pronouns,
// names (kept, none new), number words, quoted text, enough shared content in both
// directions, a capitalized sentence opener kept, a question left a question,
// and no preamble, label or JSON. Protected values (numbers,
// code, paths, URLs), symbols, capitalization, length and reasoning markers
// are checked for every style in validation.ts.
import { applySourceCorrection, contentWords } from './contentGuard';
import { formalPass } from './formalPass';
import { NEGATION, PRONOUNS } from './guardedWords';
import { tokenize } from './tokens';

/** Share of the source's content words the rewrite keeps, and vice versa. */
export const FORMAL_MIN_RETENTION = 0.5;
export const FORMAL_MIN_COVERAGE = 0.5;
/** Most consecutive source content words a rewrite may leave out. */
export const FORMAL_MAX_DROPPED_RUN = 2;

const STOPWORDS = new Set(`a an the and or but so to of in on at for with by from as into onto about
  is are was were be been being am do does did done have has had will would shall should can could may
  might must this that these those there here then than if just very really truly quite too also
  which what when where why how all any some each every only own same such more most other please
  kindly well oh hey hello hi okay ok yes yeah`.split(/\s+/u));
const NUMBER_WORDS = new Set(`zero one two three four five six seven eight nine ten eleven twelve
  thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty thirty forty fifty sixty seventy
  eighty ninety hundred thousand million billion first second third half dozen`.split(/\s+/u));
const PREAMBLE = /^\s*(?:(?:sure|certainly|of course|okay|ok)\b[\s,!.]*)?(?:here(?:'s|’s| is| are)\b|(?:the )?(?:formal|rewritten|edited|cleaned|revised|corrected) (?:version|text|transcript)\b|(?:formal|output|rewritten|transcript|answer|response|text)\s*:)/iu;
const ENVELOPE = /["“]?(?:transcript|canonicalSpellings)["”]?\s*:/iu;
const STRUCTURE = /[#&*|()[\]{}§%]/gu;
const QUOTED = /["“]([^"“”]*)["”]/gu;
const ACRONYM = /^\p{Lu}{2,}$/u;
/**
 * Sentence openers a Formal rewrite may drop or reword: discourse markers and
 * fillers. Any other capitalized opener may be a name (Rowan will ship …).
 */
const OPENERS_DROPPABLE = new Set(`like yeah yep yup nope um umm uh uhh uhm erm er hmm ah ahh basically
  honestly literally anyway anyways actually alright right sorry now look listen maybe perhaps plus
  kinda sorta gonna wanna gotta let lets let's let’s thanks thank great cool sure`.split(/\s+/u));
const WH_QUESTION = /(?:^|[.!?…]\s+)(?:what|who|whom|whose|where|which|when|why|how)\s+(?:is|are|was|were|do|does|did|can|could|will|would|should|has|have|had)\b/giu;

/**
 * Words after the Formal pass on both sides. A source word also matches its
 * spoken form when it is a dictionary repair (voxlom → voxloom), as in the
 * other styles' check.
 */
function sourceWords(text: string, dictionary: readonly string[]): string[][] {
  return contentWords(formalPass(text), dictionary, true)
    .map(({ spoken, word }) => [word, ...(spoken ?? [])]);
}

function outputWords(text: string, dictionary: readonly string[]): string[] {
  return contentWords(formalPass(text), dictionary).map(({ word }) => word);
}

function sameGuarded(ref: string[], out: string[], guarded: ReadonlySet<string>): boolean {
  const pick = (list: string[]) => list.filter((word) => guarded.has(word)).sort().join(' ');
  return pick(ref) === pick(out);
}

/** A rough stem, applied the same way to both sides: talking/talked/talks → talk. */
export function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  for (const [suffix, min] of [['ing', 6], ['ed', 5], ['ly', 5], ['es', 5], ['s', 4]] as const) {
    if (word.length >= min && word.endsWith(suffix) && !word.endsWith('ss')) return word.slice(0, -suffix.length);
  }
  return word;
}

function isContent(word: string): boolean {
  return !STOPWORDS.has(word) && !PRONOUNS.has(word) && !NEGATION.has(word);
}

/** Capitalized words not opening a sentence, and acronyms anywhere: Rowan, Casey, API. */
export function names(text: string): string[] {
  const found: string[] = [];
  for (const match of text.normalize('NFC').matchAll(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu)) {
    const word = match[0].replace(/['’]s$/u, '');
    const before = text.slice(0, match.index).replace(/["'“”‘’(\s]+$/u, '');
    const opens = before === '' || /[.!?…:]$/u.test(before);
    if (ACRONYM.test(word) || (/^\p{Lu}/u.test(word) && !opens && word !== 'I' && !/^I['’]/u.test(match[0]))) {
      found.push(word);
    }
  }
  return found;
}

/**
 * Capitalized words opening a sentence, lowercased, that are content words
 * and not a discourse marker: a sentence-initial name looks like any other
 * opener, so the rewrite must keep it (Rowan will ship → Ship is a drop).
 */
function openers(text: string): string[] {
  const found: string[] = [];
  for (const match of text.normalize('NFC').matchAll(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu)) {
    const before = text.slice(0, match.index).replace(/["'“”‘’(\s]+$/u, '');
    if (before !== '' && !/[.!?…:]$/u.test(before)) continue;
    const word = match[0].replace(/['’]s$/u, '');
    const lower = word.toLowerCase();
    if (!/^\p{Lu}\p{Ll}/u.test(word) || OPENERS_DROPPABLE.has(lower) || NUMBER_WORDS.has(lower)) continue;
    if (isContent(lower)) found.push(lower);
  }
  return found;
}

/** Every capitalized word, sentence openers included, without a trailing `'s`. */
function capitalized(text: string): string[] {
  return [...text.normalize('NFC').matchAll(/[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*/gu)]
    .map(([word]) => word.replace(/['’]s$/u, '')).filter((word) => /^\p{Lu}/u.test(word));
}

/** Sentences that ask something: end in `?`, or open with a wh-word and a verb. */
function questions(text: string): number {
  const marked = text.match(/\?/gu)?.length ?? 0;
  return Math.max(marked, text.match(WH_QUESTION)?.length ?? 0);
}

function sentences(text: string): number {
  return text.trim().split(/[.!?…]+(?:\s+|$)/u).filter((part) => /[\p{L}\p{N}]/u.test(part)).length;
}

function shares(ref: string[][], out: string[]): boolean {
  const source = ref.filter(([word]) => isContent(word)).map((keys) => keys.map(stem));
  const output = out.filter(isContent).map(stem);
  // Nothing to keep is not a license to add: `Hello, what is that?` → `The server crashed.`
  if (!source.length) return output.length === 0;
  const known = new Set(source.flat());
  const present = source.map((keys) => keys.some((key) => output.includes(key)));
  const kept = present.filter(Boolean).length;
  const covered = output.filter((word) => known.has(word)).length;
  const retention = source.length <= 2 ? 1 : FORMAL_MIN_RETENTION;
  // A rewrite rewords; it does not drop a whole phrase or sentence.
  const droppedRun = present.map((here) => (here ? '1' : '0')).join('')
    .includes('0'.repeat(FORMAL_MAX_DROPPED_RUN + 1));
  return !droppedRun && kept >= source.length * retention
    && covered >= output.length * FORMAL_MIN_COVERAGE;
}

function quotedKept(ref: string, candidate: string): boolean {
  const flat = (text: string) => tokenize(text).map(({ word }) => word).join(' ');
  const out = ` ${flat(candidate)} `;
  return [...ref.matchAll(QUOTED)].every(([, inner]) => out.includes(` ${flat(inner)} `));
}

function factsHold(ref: string, candidate: string, dictionary: readonly string[]): boolean {
  const sourceKeys = sourceWords(ref, dictionary);
  const source = sourceKeys.map(([word]) => word);
  const output = outputWords(candidate, dictionary);
  if (!sameGuarded(source, output, NEGATION) || !sameGuarded(source, output, PRONOUNS)) return false;
  const outputNames = names(candidate);
  // A dictionary repair may respell the name it repairs (Voxlom → Voxloom),
  // and only that one: every other source name must still be there.
  const spoken = new Set(sourceKeys.flatMap((keys) => keys.slice(1)));
  // A source name may open the rewrite (`Um, Rowan will` → `Rowan will`).
  const left = capitalized(candidate);
  const missing = names(ref).filter((name) => {
    const at = left.indexOf(name);
    if (at >= 0) left.splice(at, 1);
    return at < 0;
  });
  if (missing.some((name) => !spoken.has(name.toLowerCase()))) return false;
  // A capitalized opener may be a name too: it stays, as itself or its repair.
  const kept = new Set(output.map(stem));
  const keysOf = (word: string) => sourceKeys.find((keys) => keys.includes(word)) ?? [word];
  if (openers(ref).some((word) => !keysOf(word).some((key) => kept.has(stem(key))))) return false;
  // No new names: an answer ("… is Paris") or a swapped person is not a rewrite.
  const known = new Set([...source, ...dictionary.map((term) => term.toLowerCase())]);
  if (outputNames.some((name) => !known.has(name.toLowerCase()))) return false;
  // A question stays a question, with no answer sentence after it (Paris is the capital.).
  const asked = questions(formalPass(ref));
  if (asked && ((candidate.match(/\?/gu)?.length ?? 0) < asked || sentences(candidate) > sentences(ref))) return false;
  // Number words both ways: `ten servers` → `servers` drops a fact as surely as adding one.
  const numbers = (list: string[]) => list.filter((word) => NUMBER_WORDS.has(word)).sort().join(' ');
  if (numbers(source) !== numbers(output)) return false;
  return quotedKept(ref, candidate) && shares(sourceKeys, output);
}

export function preservesFormalFacts(
  raw: string,
  candidate: string,
  dictionary: readonly string[],
): boolean {
  if (PREAMBLE.test(candidate) && !PREAMBLE.test(raw)) return false;
  if (ENVELOPE.test(candidate) && !ENVELOPE.test(raw)) return false;
  const structure = (text: string) => (text.match(STRUCTURE) ?? []).sort().join('');
  if (structure(raw) !== structure(candidate)) return false;
  const quotes = (text: string) => text.match(/["“”]/gu)?.length ?? 0;
  if (quotes(raw) !== quotes(candidate)) return false;
  const corrected = applySourceCorrection(raw);
  return factsHold(raw, candidate, dictionary)
    || (corrected !== raw && factsHold(corrected, candidate, dictionary));
}
