// BUS-229: a deterministic Formal floor after the model. Qwen3 0.6B keeps
// spoken fillers and contractions even when asked for formal prose, so this
// strips clear fillers and expands contractions. It is conservative: quoted
// text, code, paths, URLs and any token with a digit or symbol are left as
// they are, ALL-CAPS words are never touched, and `like` is removed only
// where it cannot be a verb or preposition (`I like this`, `looks like rain`).

/** Hesitation sounds: always fillers. */
const HESITATIONS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'hmm', 'ah', 'ahh']);
/** Fillers only when set off by punctuation (`, yeah,`), never mid-clause. */
const SET_OFF = new Set(['yeah', 'yep', 'basically', 'honestly', 'literally', 'anyway']);
/** Words after which a leading `like` is a filler: `like right now`, `like, um`. */
const LIKE_FOLLOWERS = new Set([
  'right', 'really', 'just', 'so', 'literally', 'totally', 'basically', 'honestly',
  'actually', 'super', 'very', 'kinda', 'maybe', 'yeah', ...HESITATIONS,
]);
const CONJUNCTIONS = new Set(['and', 'but', 'so', 'or']);
/**
 * `'s` is `is` (or `has` before been/got) only after these words, never a
 * possessive. Not everyone/someone: `Everyone's laptop` is a possessive.
 */
const IS_HOSTS = new Set([
  'it', 'that', 'what', 'there', 'here', 'he', 'she', 'where', 'who', 'how',
  'everything', 'nothing', 'something',
]);
const WHOLE: Record<string, string> = {
  'can\'t': 'cannot', 'won\'t': 'will not', 'shan\'t': 'shall not', 'i\'m': 'I am',
  'let\'s': 'let us', gonna: 'going to', wanna: 'want to', gotta: 'have to',
};
// Quoted text, inline code, and any token with a digit, URL/path/code symbol.
const PROTECTED = /"[^"\n]*"|“[^”\n]*”|`[^`\n]*`|\S*(?:[\p{N}/\\@=_<>{}|#$~^*[\]+&%]|:\/\/)\S*/gu;
const PIECE = /[\p{L}\p{M}]+(?:['’][\p{L}\p{M}]+)*|[^\p{L}\p{M}]+/gu;
const WORD = /^[\p{L}\p{M}]/u;
const PLAIN_SEPARATOR = /^[\s,.!?;:…]*$/u;
const SENTENCE_END = /[.!?…]/u;

interface Piece { text: string; word: boolean; removed?: boolean }

/** Lowercase, or title case opening a sentence: never ALL-CAPS or a mid-sentence name. */
function editable(text: string, sentenceStart: boolean): boolean {
  return text === text.toLowerCase() || (sentenceStart && /^\p{Lu}[\p{Ll}'’]*$/u.test(text));
}

function withCase(source: string, replacement: string): string {
  if (replacement === 'I am') return replacement;
  return /^\p{Lu}/u.test(source) ? replacement[0].toUpperCase() + replacement.slice(1) : replacement;
}

function expandWord(text: string, next: string | undefined): string {
  const lower = text.toLowerCase().replaceAll('’', '\'');
  const whole = WHOLE[lower];
  if (whole) return withCase(text, whole);
  const contraction = /^([\p{L}]+)('re|'ve|'ll|n't|'s)$/u.exec(lower);
  if (!contraction) return text;
  const [, stem, suffix] = contraction;
  if (suffix === '\'s' && !IS_HOSTS.has(stem)) return text;
  const tail = suffix === '\'re' ? 'are' : suffix === '\'ve' ? 'have' : suffix === '\'ll' ? 'will'
    : suffix === 'n\'t' ? 'not' : next === 'been' || next === 'got' ? 'has' : 'is';
  if (suffix === 'n\'t' && stem === 'ai') return text;
  return `${text.slice(0, stem.length)} ${tail}`;
}

function markFillers(pieces: Piece[]): void {
  const words = pieces.map((piece, index) => (piece.word ? index : -1)).filter((i) => i >= 0);
  const separator = (index: number) => (pieces[index] && !pieces[index].word ? pieces[index].text : '');
  const opens = (index: number) => index === words[0] || SENTENCE_END.test(separator(index - 1));
  const before = (index: number) => index === 0 || /[,.!?;:…]/u.test(separator(index - 1));
  const after = (index: number) => index === pieces.length - 1 || /[,.!?;:…]/u.test(separator(index + 1));
  // Only the punctuation touching the word counts: a protected token before it is fine.
  const near = (text: string, side: 'before' | 'after') => (side === 'before'
    ? text.slice(text.lastIndexOf('\uE001') + 1) : text.split('\uE000')[0]);
  const plain = (index: number) => PLAIN_SEPARATOR.test(near(separator(index - 1), 'before'))
    && PLAIN_SEPARATOR.test(near(separator(index + 1), 'after'));
  words.forEach((index, at) => {
    const piece = pieces[index];
    const lower = piece.text.toLowerCase();
    if (!plain(index) || !editable(piece.text, opens(index))) return;
    const previous = pieces[words[at - 1]]?.text.toLowerCase();
    const next = pieces[words[at + 1]];
    const conjunction = previous !== undefined && CONJUNCTIONS.has(previous) && !/[^\s]/u.test(separator(index - 1));
    if (HESITATIONS.has(lower)) piece.removed = true;
    else if (SET_OFF.has(lower)) piece.removed = (before(index) || conjunction) && after(index);
    else if (lower === 'you' && next?.text === 'know' && words[at + 1] === index + 2
      && /^ $/u.test(separator(index + 1)) && (before(index) || conjunction) && after(index + 2)) {
      piece.removed = true;
      next.removed = true;
    } else if (lower === 'like') {
      const leads = before(index) || conjunction;
      const follower = next !== undefined && words[at + 1] === index + 2
        && /^\s+$/u.test(separator(index + 1)) && LIKE_FOLLOWERS.has(next.text.toLowerCase());
      piece.removed = leads && (after(index) || follower);
    }
  });
}

/** Rejoin around removed words: keep sentence punctuation, a parenthetical comma, else a space. */
function join(pieces: Piece[]): string {
  let out = '';
  let capitalize = false;
  let i = 0;
  while (i < pieces.length) {
    const piece = pieces[i];
    if (!piece.removed) {
      let text = piece.text;
      if (capitalize && piece.word && !/\p{Lu}/u.test(text)) text = text[0].toUpperCase() + text.slice(1);
      // A protected value (number, path, quote) also ends the capitalization run.
      if (piece.word || text.includes('\uE000')) capitalize = false;
      out += text;
      i++;
      continue;
    }
    // A run of removed words and the separators between them.
    const startedAt = out.length === 0 || SENTENCE_END.test(out.trimEnd().slice(-1));
    const leftSeparator = /[^\p{L}\p{M}\p{N}\uE001]*$/u.exec(out)?.[0] ?? '';
    out = out.slice(0, out.length - leftSeparator.length);
    let gap = leftSeparator;
    // `Right now, you know, it works` keeps its comma; `We should, um, meet` and `is, like, broken` do not.
    let parenthetical = false;
    for (; i < pieces.length && (pieces[i].removed || !pieces[i].word); i++) {
      const lower = pieces[i].text.toLowerCase();
      // A protected value is never part of the gap: keep the separator before
      // it and leave the value and the rest of the piece to be emitted as is.
      const protectedAt = pieces[i].removed ? -1 : pieces[i].text.indexOf('\uE000');
      if (protectedAt >= 0) {
        gap += pieces[i].text.slice(0, protectedAt);
        pieces[i] = { ...pieces[i], text: pieces[i].text.slice(protectedAt) };
        break;
      }
      if (pieces[i].removed && !HESITATIONS.has(lower) && lower !== 'like') parenthetical = true;
      gap += pieces[i].removed ? ' ' : pieces[i].text;
    }
    const atEnd = i >= pieces.length;
    const end = /[.!?…]+/u.exec(gap)?.[0];
    const lastWord = /[\p{L}]+$/u.exec(out)?.[0]?.toLowerCase();
    if (out.length === 0) gap = '';
    else if (atEnd) gap = end ?? '';
    else if (end) gap = `${end} `;
    else if (/[;:]/u.test(gap)) gap = `${/[;:]/u.exec(gap)![0]} `;
    else if (parenthetical && /,/u.test(leftSeparator) && /,\s*$/u.test(gap)
      && !CONJUNCTIONS.has(lastWord ?? '')) gap = ', ';
    else gap = ' ';
    out += gap;
    capitalize = startedAt || Boolean(end);
  }
  return out;
}

export function formalPass(text: string): string {
  const kept: string[] = [];
  const masked = text.normalize('NFC').replace(PROTECTED, (match) => {
    // Sentence punctuation after a path or URL is not part of it.
    const [, token, tail] = /^(.*?)([.,!?;:]*)$/su.exec(match)!;
    return `\uE000${kept.push(token) - 1}\uE001${tail}`;
  });
  const pieces: Piece[] = (masked.match(PIECE) ?? []).map((part) => ({ text: part, word: WORD.test(part) }));
  markFillers(pieces);
  pieces.forEach((piece, index) => {
    if (!piece.word || piece.removed || !editable(piece.text, true)) return;
    const next = pieces.slice(index + 1).find((later) => later.word && !later.removed)?.text.toLowerCase();
    piece.text = expandWord(piece.text, next);
  });
  return join(pieces).replace(/\uE000(\d+)\uE001/gu, (_, at: string) => kept[Number(at)]).trim();
}
