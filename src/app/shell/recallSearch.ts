import type { DictationRecord } from '../../domain/types';

/** Dictations shown before you type, and the most shown for a query. */
export const RECALL_RECENT = 5;
export const RECALL_LIMIT = 7;

const escape = (term: string) => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Lower-cased search words. A dictation matches when it contains every one, in any order. */
export function recallTerms(query: string): string[] {
  return [...new Set(query.toLowerCase().split(/\s+/).filter(Boolean))];
}

export type RecallMatches = { shown: DictationRecord[]; total: number };

/** Newest first. With no words, the latest few; otherwise every dictation holding all the words. */
export function recallMatches(records: readonly DictationRecord[], terms: readonly string[]): RecallMatches {
  const newest = [...records].sort((a, b) => b.createdAt - a.createdAt);
  if (!terms.length) return { shown: newest.slice(0, RECALL_RECENT), total: newest.length };
  const tests = terms.map((term) => new RegExp(escape(term), 'iu'));
  const hits = newest.filter((record) => tests.every((test) => test.test(record.text)));
  return { shown: hits.slice(0, RECALL_LIMIT), total: hits.length };
}

export type RecallPiece = { text: string; hit: boolean };

/**
 * The dictation split into plain and matched pieces. A long dictation whose first match
 * lies deep inside is cut to start a little before it, so the hit stays on the one line.
 * Matching runs on the original text, so case folding never shifts the offsets.
 */
export function recallSnippet(text: string, terms: readonly string[], lead = 40): RecallPiece[] {
  if (!terms.length) return [{ hit: false, text }];
  const pattern = new RegExp([...terms].sort((a, b) => b.length - a.length).map(escape).join('|'), 'giu');
  const marks = [...text.matchAll(pattern)].map((match) => [match.index, match.index + match[0].length] as const);
  const first = marks[0]?.[0] ?? 0;
  let start = 0;
  if (first > lead && text.length > lead * 2) {
    const space = text.indexOf(' ', first - lead);
    start = space >= 0 && space < first ? space + 1 : first - lead;
  }
  const pieces: RecallPiece[] = start ? [{ hit: false, text: '…' }] : [];
  let at = start;
  for (const [from, to] of marks) {
    if (to <= at) continue;
    if (from > at) pieces.push({ hit: false, text: text.slice(at, from) });
    pieces.push({ hit: true, text: text.slice(Math.max(from, at), to) });
    at = to;
  }
  if (at < text.length) pieces.push({ hit: false, text: text.slice(at) });
  return pieces;
}
