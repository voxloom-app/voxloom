import { readFileSync } from 'node:fs';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppProvider } from '../../src/app/AppContext';
import { initialWords } from '../../src/domain/fixtures';
import { Dictionary } from '../../src/features/dictionary/Dictionary';
import {
  formsByWord, proofSegments, restoredForms, type ProofSegment,
} from '../../src/features/dictionary/spellingForms';
import { createDictionaryStore, createMemoryDictionaryIo } from '../../src/services/dictionary';
import { replaceDictionaryTerms } from '../../src/services/dictionary/replace';
import { renderWithApp } from './testUtils';

// Public synthetic vocabulary (the same sample the Dictionary E2E uses).
const vocabulary = [
  'API', 'async', 'AST', 'backoff', 'bytecode', 'cache', 'CLI', 'codec', 'daemon', 'debounce',
  'endpoint', 'event loop', 'fallback', 'Git', 'gRPC', 'hash', 'HTTP', 'idempotent', 'JSON',
  'kernel', 'latency', 'Markdown', 'mutex', 'Node.js', 'OAuth', 'pipeline', 'query', 'Rust',
  'SDK', 'TypeScript', 'Unicode', 'WebSocket', 'YAML', 'zero-copy', 'TanStack Query', 'Postgres',
];

const joined = (segments: ProofSegment[]) => segments.map((s) => (s.kind === 'text' ? s.text : s.typed)).join('');
const catches = (segments: ProofSegment[]) => segments.flatMap((s) => (s.kind === 'catch' ? [[s.typed, s.heard]] : []));
const check = () => screen.getByRole('textbox', { name: /^What does Voxloom write instead\?/ });
const preview = () => document.getElementById('dictionary-heard-preview')!;
const marks = () => [...preview().querySelectorAll('mark')].map((mark) => mark.textContent);
/** Text a screen reader gets: aria-hidden decoration removed. */
const spoken = (element: HTMLElement) => {
  const copy = element.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return copy.textContent;
};

describe('restored forms (ui-iter-05; shown as "replaces" on each row since ui-iter-35)', () => {
  it('lists split, lowercase and hyphenated forms the real matcher writes back as the spelling', () => {
    expect(restoredForms('TanStack Query', initialWords)).toEqual(['tan stack query', 'tanstack query', 'tan-stack query']);
    expect(restoredForms('TypeScript', initialWords)).toEqual(['type script', 'typescript', 'type-script']);
    expect(restoredForms('JSON', initialWords)).toEqual(['json']);
    expect(restoredForms('zero-copy', vocabulary)).toEqual(['zero copy', 'zerocopy']);
    // "g rpc" and "o auth" are not joined by the matcher, so they are never shown.
    expect(restoredForms('gRPC', vocabulary)).toEqual(['grpc']);
    expect(restoredForms('OAuth', vocabulary)).toEqual(['oauth']);
    // Already as heard: nothing to restore.
    expect(restoredForms('async', vocabulary)).toEqual([]);
    expect(restoredForms('A'.repeat(41), ['A'.repeat(41)])).toEqual([]);
  });

  it('never shows a form the dictation path would not restore', () => {
    const forms = formsByWord(vocabulary);
    for (const [word, list] of forms) {
      expect(list.length).toBeLessThanOrEqual(3);
      for (const form of list) expect(replaceDictionaryTerms(form, vocabulary), `${form} → ${word}`).toBe(word);
    }
    expect([...forms.values()].flat().length).toBeGreaterThanOrEqual(20);
  });
});

describe('proof segments', () => {
  it('knots each restored stretch with what was heard, leaving punctuation plain', () => {
    const heard = 'Follow up on type script, tan stack query and postgres.';
    const typed = replaceDictionaryTerms(heard, initialWords);
    const segments = proofSegments(heard, typed);
    expect(joined(segments)).toBe(typed);
    expect(segments).toEqual([
      { kind: 'text', text: 'Follow up on ' },
      { heard: 'type script', kind: 'catch', typed: 'TypeScript' },
      { kind: 'text', text: ', ' },
      { heard: 'tan stack query', kind: 'catch', typed: 'TanStack Query' },
      { kind: 'text', text: ' and ' },
      { heard: 'postgres', kind: 'catch', typed: 'Postgres' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('keeps a spelling with inner punctuation whole and trims shared brackets', () => {
    expect(catches(proofSegments('ship node.js today', 'ship Node.js today'))).toEqual([['Node.js', 'node.js']]);
    // Only a hyphen appears: the stretch is still knotted.
    const hyphen = 'Follow up on zero copy, yaml and web socket.';
    expect(catches(proofSegments(hyphen, replaceDictionaryTerms(hyphen, vocabulary))))
      .toEqual([['zero-copy', 'zero copy'], ['YAML', 'yaml'], ['WebSocket', 'web socket']]);
    const bracketed = proofSegments('use (postgres) now', 'use (Postgres) now');
    expect(bracketed).toEqual([
      { kind: 'text', text: 'use (' },
      { heard: 'postgres', kind: 'catch', typed: 'Postgres' },
      { kind: 'text', text: ') now' },
    ]);
  });

  it('always rebuilds the typed text and returns plain text when nothing changed', () => {
    expect(proofSegments('nothing here', 'nothing here')).toEqual([{ kind: 'text', text: 'nothing here' }]);
    expect(proofSegments('', '')).toEqual([]);
    for (const heard of [
      'web socket,web socket', '  json  ', 'type-script and typescript; tanstack query!', 'git: event-loop / zero copy',
      'see --type-script now', 'use `typescript` here', 'Type script is fine', 'json. Postgres',
    ]) {
      const typed = replaceDictionaryTerms(heard, vocabulary);
      const segments = proofSegments(heard, typed);
      expect(joined(segments), heard).toBe(typed);
      for (const [typedPart, heardPart] of catches(segments)) {
        expect(typedPart).not.toBe(heardPart);
        expect(heard).toContain(heardPart);
      }
    }
  });
});

describe('The Add sheet checks a mistake against the word being saved (ui-iter-35)', () => {
  async function openAdd(word: string) {
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add a word' }));
    if (word) await user.type(screen.getByRole('textbox', { name: 'Word' }), word);
    return user;
  }

  it('previews the fix with the new word included, marking what it replaces, and labels it a preview', async () => {
    renderWithApp(<Dictionary />);
    const user = await openAdd('Voxloom');
    expect(check()).toHaveAttribute('type', 'text');
    expect(check()).toHaveAttribute('placeholder', 'For example: voxloom');
    expect(screen.getAllByRole('searchbox')).toHaveLength(1);
    expect(preview()).toHaveTextContent('Type a mistake you’ve seen to check how Voxloom will write it.');
    expect(screen.getByText('Only the word is saved. This preview isn’t.')).toBeInTheDocument();
    await user.type(check(), 'ship it with vox loom');
    expect(marks()).toEqual(['Voxloom']);
    expect(spoken(preview())).toBe('Preview: ship it with Voxloom (replaces vox loom)Fixed: Voxloom will write it like this.');
    for (const tag of preview().querySelectorAll('.word-check__was')) expect(tag).toHaveAttribute('aria-hidden', 'true');
    // jsdom's name computation drops inline spacing; browsers keep it.
    expect(check()).toHaveAccessibleDescription(/^Preview:\s*ship it with\s*Voxloom\s*\(replaces vox loom\)/);
    expect(document.querySelector('.word-check')).toHaveAttribute('data-state', 'fixed');
  });

  it('says plainly when spelling alone will not change a mistake, or when it is already right', async () => {
    renderWithApp(<Dictionary />);
    const user = await openAdd('Voxloom');
    await user.type(check(), 'box loom');
    expect(marks()).toEqual([]);
    expect(preview()).toHaveTextContent('Not changed by spelling alone. Whisper or cleanup may still catch it.');
    expect(document.querySelector('.word-check')).toHaveAttribute('data-state', 'unchanged');
    await user.clear(check());
    await user.type(check(), 'Voxloom');
    expect(preview()).toHaveTextContent('That’s already your spelling.');
    // Words already saved are fixed too, so the preview matches a real dictation.
    await user.clear(check());
    await user.type(check(), 'we keep json in postgres');
    expect(marks()).toEqual(['JSON', 'Postgres']);
  });

  it('checks an edit against the new spelling, not the one it replaces', async () => {
    const user = userEvent.setup();
    renderWithApp(<Dictionary />);
    await user.click(screen.getByRole('button', { name: 'Edit Postgres' }));
    const word = screen.getByRole('textbox', { name: 'Word' });
    await user.clear(word);
    await user.type(word, 'PostgreSQL');
    await user.type(check(), 'postgres');
    expect(marks()).toEqual([]);
    await user.clear(check());
    await user.type(check(), 'postgresql');
    expect(marks()).toEqual(['PostgreSQL']);
  });

  it('keeps the Word field and its errors as they were, with a plain hint until an error replaces it', async () => {
    renderWithApp(<Dictionary />);
    const user = await openAdd('');
    const word = screen.getByLabelText('Word');
    expect(word).toHaveFocus();
    expect(word).toHaveAccessibleDescription('A word or name, spelled exactly as you want it written.');
    await user.type(check(), 'vox loom');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(word).toHaveAttribute('aria-invalid', 'true');
    expect(word).toHaveAccessibleDescription('Enter a word.');
    expect(screen.queryByText('A word or name, spelled exactly as you want it written.')).toBeNull();
  });

  it('saves only the word: the mistake you checked is never stored', async () => {
    const raw = '{"version":1,"words":["Postgres","TypeScript"]}\n';
    const io = createMemoryDictionaryIo(raw);
    const store = createDictionaryStore(io);
    const save = vi.spyOn(store, 'save');
    const user = userEvent.setup();
    render(<AppProvider dictionaryPersistence={{ enabled: true, store }}><Dictionary /></AppProvider>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit Postgres' })).toBeInTheDocument());
    await user.click(screen.getByRole('button', { name: 'Add a word' }));
    await user.type(screen.getByRole('textbox', { name: 'Word' }), 'Voxloom');
    await user.type(check(), 'vox loom');
    expect(save).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(io.snapshot()).toBe(raw);
    await user.click(screen.getByRole('button', { name: 'Add a word' }));
    expect(check()).toHaveValue('');
    await user.type(screen.getByRole('textbox', { name: 'Word' }), 'Voxloom');
    await user.type(check(), 'vox loom{Enter}');
    await waitFor(() => expect(JSON.parse(io.snapshot()!).words).toEqual(['Postgres', 'TypeScript', 'Voxloom']));
    expect(io.snapshot()).not.toContain('vox loom');
    expect(within(screen.getByRole('list', { name: 'Dictionary words, alphabetical' })).getByText('Voxloom')).toBeInTheDocument();
  });

  it('keeps the list, the guide and the check at AA in both themes', () => {
    const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(hex(a)), lum(hex(b))].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    const mix = (a: string, b: string, t: number) => '#' + hex(a).map((v, i) => Math.round(v * t + hex(b)[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
    // The list and guide lie open on the page (ui-iter-31): the night page over the frame's stops,
    // and the daylight page on linen with the daylight tokens. The check sits on the sheet.
    const tokens = readFileSync('src/styles/tokens.css', 'utf8');
    const night = tokens.slice(0, tokens.indexOf('[data-appearance-resolved="light"] {'));
    const lightRoot = tokens.slice(tokens.indexOf('[data-appearance-resolved="light"] {'));
    const daylight = readFileSync('src/styles/daylight.css', 'utf8');
    const day = daylight.slice(daylight.indexOf('.main .page-body, .settings-window > .settings-panel'));
    const css = readFileSync('src/styles/dictionary-stage.css', 'utf8');
    const indexCss = readFileSync('src/styles/dictionary.css', 'utf8');
    expect(indexCss).not.toMatch(/\.word-index \{[^}]*background/);
    expect(indexCss).toContain('var(--accfg) 8%, var(--bg)');
    expect(indexCss).toMatch(/\.term-row__replaces \{[^}]*color: var\(--mut\);/);
    expect(css).toContain('background: color-mix(in srgb, var(--brand-a) 9%, transparent);');
    expect(readFileSync('src/styles/daylight-pages.css', 'utf8'))
      .toContain('.word-check__fix { background: color-mix(in srgb, #b6ff3c 42%, transparent);');
    const themes = [
      { block: night, sheetBlock: night, paper: '#121219', ground: ['#17171f', '#0a0a0e'], highlight: .09 },
      { block: day, sheetBlock: lightRoot, paper: '#f4f1ea', ground: ['#e9e4da'], highlight: .42 },
    ];
    for (const { block, sheetBlock, paper, ground, highlight } of themes) {
      const token = (name: string, from = block) => new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(from)![1];
      for (const surface of [paper, ...ground, mix(token('accfg'), paper, .08)]) {
        for (const ink of ['mut', 'fg', 'accfg']) {
          expect(ratio(token(ink), surface), `${ink} on ${surface}`).toBeGreaterThanOrEqual(4.5);
        }
      }
      const sheet = token('sheet', sheetBlock);
      for (const ink of ['mut', 'fg', 'accfg']) expect(ratio(token(ink, sheetBlock), sheet), `${ink} on the sheet`).toBeGreaterThanOrEqual(4.5);
      expect(ratio(token('accfg', sheetBlock), mix('#b6ff3c', sheet, highlight))).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('holds the fix marks still under reduced motion', () => {
    const css = readFileSync('src/styles/dictionary-stage.css', 'utf8');
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.word-check__fix { animation: none; }');
  });
});
