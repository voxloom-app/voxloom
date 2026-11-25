// @vitest-environment node
// BUS-229: opt-in evaluation of the writing styles with the real cleanup
// model. Skipped unless both variables are set (default CI needs no GGUF):
//
//   VOXLOOM_TEST_CLEANUP_MODEL=/path/Qwen3-0.6B-Q4_K_M.gguf \
//   VOXLOOM_TEST_CLEANUP_WORKER=/path/voxloom-cleanup-worker \
//   VOXLOOM_EVAL_OUT=/tmp/style-eval.json npx vitest run tests/unit/cleanup/styleEval.test.ts
//
// Each corpus dictation goes through the deterministic dictionary step, then
// runCleanup per style with the real prompt, worker, output check and
// Formal pass, exactly as dictation does. Greedy decoding on CPU: indicative
// of the model's behaviour, not of Metal timing. The assertions are what PR1
// on Qwen3 0.6B must do (facts kept in every final text, fillers out of every
// cleaned Formal text, styles differ, the BUS-229 sentence cleaned in every style,
// few Formal fallbacks), not 4B-quality formal prose.
import { writeFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

import corpus from '../../fixtures/style-eval/corpus.json';
import type { WritingStyle } from '../../../src/domain/types';
import { snapshotDictionary } from '../../../src/services/cleanup/prompt';
import { runCleanup } from '../../../src/services/cleanup/runCleanup';
import type { CleanupOutcome } from '../../../src/services/cleanup/types';
import { replaceDictionaryTerms } from '../../../src/services/dictionary/replace';
import { askWorker } from './realWorker';

const MODEL = process.env.VOXLOOM_TEST_CLEANUP_MODEL;
const WORKER = process.env.VOXLOOM_TEST_CLEANUP_WORKER;
const STYLES: WritingStyle[] = ['formal', 'casual', 'very-casual'];

interface Item {
  dictionary?: string[]; formalDrops: string[]; id: string; keep: string[];
  kind: string; raw: string; veryCasualKeeps?: string[];
}

interface Row {
  fails: string[]; final: string; id: string; model: string | null; ms: number;
  status: CleanupOutcome['status']; style: WritingStyle;
}

const matches = (text: string, pattern: string) => new RegExp(pattern, 'iu').test(text);

async function clean(item: Item, style: WritingStyle): Promise<Row> {
  const dictionary = snapshotDictionary(item.dictionary ?? []);
  // Dictation hands cleanup the deterministically spelled transcript.
  const rawText = replaceDictionaryTerms(item.raw, dictionary);
  let model: string | null = null;
  let ms = 0;
  const outcome = await runCleanup({
    engine: {
      cancel: async () => {},
      run: async ({ prompt }) => {
        const reply = await askWorker(WORKER!, MODEL!, prompt);
        model = reply.text;
        ms = reply.ms;
        if (reply.text === null) throw new Error('worker error');
        return reply.text;
      },
    },
    rawText, requestId: `${item.id}-${style}`,
    signal: { aborted: false, onAbort: vi.fn() },
    snapshot: { dictionary, enabled: true, modelId: 'qwen3-0.6b-q4-k-m', style },
    timeoutMs: 120_000,
  });
  const final = 'finalText' in outcome ? outcome.finalText : '';
  const fails = [
    ...item.keep.filter((pattern) => !matches(final, pattern)).map((pattern) => `lost ${pattern}`),
    // A fallback is the raw text by design (the check refused the model's output).
    ...(style === 'formal' && outcome.status === 'cleaned' ? item.formalDrops : [])
      .filter((pattern) => matches(final, pattern))
      .map((pattern) => `formal kept ${pattern}`),
    ...(style === 'very-casual' ? item.veryCasualKeeps ?? [] : [])
      .filter((pattern) => !matches(final, pattern)).map((pattern) => `very casual dropped ${pattern}`),
  ];
  return { fails, final, id: item.id, model, ms, status: outcome.status, style };
}

describe.skipIf(!MODEL || !WORKER)('writing styles, real model', () => {
  it('keeps facts, drops fillers in Formal, keeps them in Very Casual, and the styles differ', async () => {
    const items = corpus.items as Item[];
    expect(items.length).toBeGreaterThan(8);
    const rows: Row[] = [];
    for (const item of items) {
      for (const style of STYLES) rows.push(await clean(item, style));
    }
    const of = (style: WritingStyle) => rows.filter((row) => row.style === style);
    const final = (id: string, style: WritingStyle) => rows.find((row) => row.id === id && row.style === style)!.final;
    const differing = items.filter(({ id }) => final(id, 'formal') !== final(id, 'very-casual')).length;
    const summary = {
      differingFormalVsVeryCasual: differing,
      fails: Object.fromEntries(STYLES.map((style) => [style, of(style).filter((row) => row.fails.length).length])),
      fallbacks: Object.fromEntries(STYLES.map((style) => [style, of(style).filter((row) => row.status === 'fallback').length])),
      items: items.length,
      workerErrors: rows.filter((row) => row.model === null).length,
    };
    if (process.env.VOXLOOM_EVAL_OUT) {
      writeFileSync(process.env.VOXLOOM_EVAL_OUT, JSON.stringify({ rows, summary }, null, 1));
    }
    console.table(rows.map(({ fails, final: text, id, status, style }) => ({ fails: fails.join('; '), final: text, id, status, style })));
    console.log(JSON.stringify(summary));

    // Hard properties for PR1 on 0.6B.
    expect(summary.workerErrors).toBe(0);
    expect(rows.filter((row) => row.fails.length).map(({ fails, id, style }) => `${id}/${style}: ${fails.join('; ')}`))
      .toEqual([]);
    const ticket = 'ticket-sentence';
    for (const style of STYLES) expect(rows.find((row) => row.id === ticket && row.style === style)!.status).toBe('cleaned');
    expect(final(ticket, 'formal')).not.toBe(final(ticket, 'very-casual'));
    expect(differing).toBeGreaterThanOrEqual(Math.ceil(items.length / 2));
    // Formal must not fall back for most dictations (before BUS-229 every
    // filler-bearing Formal output fell back). A few refusals of genuinely
    // bad 0.6B output (a dropped number, a dropped sentence) are expected.
    expect(summary.fallbacks.formal).toBeLessThanOrEqual(Math.floor(items.length / 4));
  }, 60 * 60_000);
});
