// @vitest-environment node
// BUS-188 (Sophie's ruling): with no dictionary words the cleanup prompt is
// main's (d2d4ee9, cleanup-v2), so the dictionary adds no text for people who
// do not use it, and the version row says so. BUS-229 then changed exactly
// three lines for every user (per-style rules, filler removal out of the
// shared base): the prompt must equal main's with only those lines replaced.
import { webcrypto } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  CLEANUP_PROMPT_VERSION,
  CLEANUP_PROMPT_VERSION_NO_DICTIONARY,
  cleanupPromptVersion,
} from '../../../src/domain/cleanup';
import { buildCleanupPrompt, styleInstruction } from '../../../src/services/cleanup/prompt';
import { createCleanupProvenance } from '../../../src/services/cleanup/provenance';
import { runCleanup } from '../../../src/services/cleanup/runCleanup';
import type { WritingStyle } from '../../../src/domain/types';
// Prompts that main d2d4ee9's buildCleanupPrompt produced for an empty
// dictionary, generated once from that commit (3 styles x 5 transcripts).
import mainPrompts from '../../fixtures/cleanup-prompt-main-d2d4ee9-empty-dictionary.json';

const PARAGRAPH = 'canonicalSpellings are words the speaker uses.';
const MAIN_LINE = 'Use canonicalSpellings only to correct the spelling of existing words.';

/** main's prompt with BUS-229's three lines swapped in, and nothing else. */
function withStyleRules(prompt: string, style: WritingStyle): string {
  const swaps: Record<string, string> = {
    'Fix capitalization and punctuation. Remove hesitation fillers such as um and uh.':
      'Fix capitalization and punctuation.',
    'quotes, corrections, intent, and voice.': 'quotes, corrections, and core meaning.',
    'Use polished, professional presentation.': styleInstruction(style),
    'Use natural, conversational presentation.': styleInstruction(style),
    'Preserve contractions and the speaker\'s informal voice.': styleInstruction(style),
  };
  let swapped = 0;
  const lines = prompt.split('\n').map((line) => {
    if (!(line in swaps)) return line;
    swapped++;
    return swaps[line];
  });
  expect(swapped).toBe(3);
  return lines.join('\n');
}

beforeAll(() => {
  vi.stubGlobal('crypto', webcrypto);
});

describe('an empty dictionary gives main\'s prompt plus BUS-229\'s style lines', () => {
  it('has the fixture from main', () => {
    expect(mainPrompts).toHaveLength(15);
  });

  it.each(mainPrompts)('is main\'s with only the style lines changed for $style: $rawText', (row) => {
    const style = row.style as WritingStyle;
    const prompt = buildCleanupPrompt({ dictionary: [], rawText: row.rawText, style });
    expect(prompt).toBe(withStyleRules(row.prompt, style));
    expect(prompt).toContain(MAIN_LINE);
    expect(prompt).not.toContain(PARAGRAPH);
  });

  it('sends the paragraph instead of main\'s line once there is a word', () => {
    const prompt = buildCleanupPrompt({
      dictionary: ['Voxloom'], rawText: 'hi', style: 'casual',
    });
    expect(prompt).toContain(PARAGRAPH);
    expect(prompt).toContain('Otherwise leave the words');
    expect(prompt).not.toContain(MAIN_LINE);
  });

  it('is the prompt the engine receives, also for a dictionary of blanks', async () => {
    const sent: string[] = [];
    const engine = {
      cancel: vi.fn(),
      run: vi.fn(async (request: { prompt: string }) => {
        sent.push(request.prompt);
        return 'Hi.';
      }),
    };
    const row = mainPrompts[0];
    for (const dictionary of [[], ['', '  ']]) {
      await runCleanup({
        engine, rawText: row.rawText, requestId: 'r1',
        signal: { aborted: false, onAbort: vi.fn() },
        snapshot: {
          dictionary, enabled: true, modelId: 'qwen3-0.6b-q4-k-m',
          style: row.style as WritingStyle,
        },
      });
    }
    const expected = withStyleRules(row.prompt, row.style as WritingStyle);
    expect(sent).toEqual([expected, expected]);
  });
});

describe('the version names the prompt that was built', () => {
  it('is v4 for no words and v5 for some (BUS-229 bumped both)', () => {
    expect(CLEANUP_PROMPT_VERSION_NO_DICTIONARY).toBe('cleanup-v4');
    expect(CLEANUP_PROMPT_VERSION).toBe('cleanup-v5');
    expect(cleanupPromptVersion([])).toBe('cleanup-v4');
    expect(cleanupPromptVersion(['Voxloom'])).toBe('cleanup-v5');
  });

  it.each([
    [[], 'cleanup-v4'],
    [['', '  '], 'cleanup-v4'],
    [['Voxloom'], 'cleanup-v5'],
  ])('is recorded for dictionary %j as %s', async (dictionary, version) => {
    const provenance = await createCleanupProvenance({
      dictionary, enabled: true, modelId: 'qwen3-0.6b-q4-k-m', style: 'casual',
    }, { finalText: 'raw', reason: 'invalid-output', status: 'fallback' });
    expect(provenance.promptVersion).toBe(version);
  });
});
