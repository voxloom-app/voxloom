// BUS-229: what each style delivers end to end for the BUS-229 sentence, given
// what Qwen3 0.6B actually returns (it drops only "uh" in every style).
import { describe, expect, it, vi } from 'vitest';
import type { WritingStyle } from '../../../src/domain/types';
import { runCleanup } from '../../../src/services/cleanup/runCleanup';

const TICKET = 'Like right now, talking to you and uh, yeah, like, that\'s so cool.';
const QWEN_06B = 'Like right now, talking to you and yeah, like, that\'s so cool.';

function run(style: WritingStyle, output: string, rawText = TICKET, engine = {
  cancel: vi.fn(), run: vi.fn().mockResolvedValue(output),
}) {
  return runCleanup({
    engine, rawText, requestId: 'r1',
    signal: { aborted: false, onAbort: vi.fn() },
    snapshot: { dictionary: [], enabled: true, modelId: 'qwen3-0.6b-q4-k-m', style },
  });
}

describe('runCleanup by style', () => {
  it('Formal: 0.6B output is accepted and the Formal pass removes the fillers', async () => {
    await expect(run('formal', QWEN_06B)).resolves.toEqual({
      finalText: 'Right now, talking to you and that is so cool.', status: 'cleaned',
    });
  });

  it('Formal: a real rewrite is delivered, not the raw text', async () => {
    await expect(run('formal', 'Talking with you right now is so cool.')).resolves.toEqual({
      finalText: 'Talking with you right now is so cool.', status: 'cleaned',
    });
  });

  it('Formal: meaning-destroying output still falls back to the raw text, untouched', async () => {
    await expect(run('formal', 'That is so cool.')).resolves.toEqual({
      finalText: TICKET, reason: 'invalid-output', status: 'fallback',
    });
  });

  it('Casual and Very Casual keep the speaker\'s fillers', async () => {
    for (const style of ['casual', 'very-casual'] as const) {
      await expect(run(style, QWEN_06B)).resolves.toEqual({ finalText: QWEN_06B, status: 'cleaned' });
      await expect(run(style, TICKET)).resolves.toEqual({ finalText: TICKET, status: 'cleaned' });
    }
  });

  it('the styles now differ on the same model output', async () => {
    const formal = (await run('formal', QWEN_06B)) as { finalText: string };
    const casual = (await run('casual', QWEN_06B)) as { finalText: string };
    expect(formal.finalText).not.toBe(casual.finalText);
    expect(formal.finalText).not.toMatch(/\b(?:like|yeah|uh)\b/iu);
  });

  it('Formal sends the model the transcript after the Formal pass; other styles send it as spoken', async () => {
    const transcript = (engine: { run: ReturnType<typeof vi.fn> }) =>
      JSON.parse((engine.run.mock.calls[0][0] as { prompt: string }).prompt.split('\n').at(-1)!).transcript;
    const formal = { cancel: vi.fn(), run: vi.fn().mockResolvedValue(QWEN_06B) };
    await run('formal', QWEN_06B, TICKET, formal);
    expect(transcript(formal)).toBe('Right now, talking to you and that is so cool.');
    const casual = { cancel: vi.fn(), run: vi.fn().mockResolvedValue(QWEN_06B) };
    await run('casual', QWEN_06B, TICKET, casual);
    expect(transcript(casual)).toBe(TICKET);
  });

  it('drops an echoed "transcript:" label instead of falling back', async () => {
    await expect(run('formal', 'transcript: Right now, talking to you and that is so cool.')).resolves.toEqual({
      finalText: 'Right now, talking to you and that is so cool.', status: 'cleaned',
    });
    await expect(run('very-casual', `Transcript: ${QWEN_06B}`)).resolves.toEqual({ finalText: QWEN_06B, status: 'cleaned' });
    // A dictated label stays.
    await expect(run('very-casual', 'Transcript: send it.', 'transcript: send it')).resolves.toEqual({
      finalText: 'Transcript: send it.', status: 'cleaned',
    });
  });
});
