import { readFileSync } from 'node:fs';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AppProvider } from '../../src/app/AppContext';
import { initialWords } from '../../src/domain/fixtures';
import { Dictionary } from '../../src/features/dictionary/Dictionary';
import {
  formsByWord, proofSegments, restoredForms, sampleSentence, type ProofSegment,
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
const proof = () => screen.getByRole('textbox', { name: 'Heard: try a sentence' });
const typedLine = () => document.getElementById('dictionary-proof-typed')!;
/** Text a screen reader gets: aria-hidden decoration removed. */
const spoken = (element: HTMLElement) => {
  const copy = element.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return copy.textContent;
};

describe('restored forms (ui-iter-05)', () => {
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

  it('builds the sample from the newest spellings, or leaves it empty', () => {
    const forms = formsByWord(initialWords);
    expect(sampleSentence(initialWords, forms)).toBe('Follow up on type script, tan stack query and postgres.');
    expect(sampleSentence(['Postgres'], formsByWord(['Postgres']))).toBe('Follow up on postgres.');
    expect(sampleSentence(['async'], formsByWord(['async']))).toBe('');
    expect(sampleSentence([], new Map())).toBe('');
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

describe('Dictionary spelling stage', () => {
  it('opens the sentence proof on the saved spellings, knotting each restored stretch', async () => {
    const user = userEvent.setup();
    renderWithApp(<Dictionary />);
    await user.click(screen.getByRole('radio', { name: 'Sentence proof' }));
    const stage = document.querySelector('.dictionary-stage')!;
    expect(stage).toHaveClass('stage');
    expect(within(stage as HTMLElement).getByRole('heading', { level: 1, name: 'Dictionary' })).toBeInTheDocument();
    expect(within(stage as HTMLElement).getByRole('button', { name: 'Add term' })).toBeInTheDocument();
    expect(proof()).toHaveValue('Follow up on type script, tan stack query and postgres.');
    expect(proof()).toHaveAttribute('type', 'text');
    expect(screen.getAllByRole('searchbox')).toHaveLength(1);
    expect(spoken(typedLine())).toBe('Voxloom types: Follow up on TypeScript (heard as type script), TanStack Query (heard as tan stack query) and Postgres (heard as postgres).');
    expect([...typedLine().querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['TypeScript', 'TanStack Query', 'Postgres']);
    // The visible "heard" tags are decoration; screen readers get the parenthesis.
    for (const tag of typedLine().querySelectorAll('.proof__was')) expect(tag).toHaveAttribute('aria-hidden', 'true');
    // jsdom's name computation drops inline spacing; browsers keep it.
    expect(proof()).toHaveAccessibleDescription(/^Voxloom types:\s*Follow up on\s*TypeScript\s*\(heard as type script\)/);
    expect(screen.getByText('3 restored')).toBeInTheDocument();
  });

  it('proofs what you type, live, without saving it or changing the dictionary', async () => {
    const raw = '{"version":1,"words":["Postgres","TypeScript"]}\n';
    const io = createMemoryDictionaryIo(raw);
    const store = createDictionaryStore(io);
    const save = vi.spyOn(store, 'save');
    const user = userEvent.setup();
    render(<AppProvider dictionaryPersistence={{ enabled: true, store }}><Dictionary /></AppProvider>);
    await user.click(screen.getByRole('radio', { name: 'Sentence proof' }));
    await waitFor(() => expect(proof()).toHaveValue('Follow up on type script and postgres.'));
    await user.clear(proof());
    expect(typedLine()).toHaveTextContent('Your spellings appear here.');
    expect(document.querySelector('.proof__count')).toHaveTextContent('');
    await user.type(proof(), 'we moved to postgres');
    expect([...typedLine().querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['Postgres']);
    expect(screen.getByText('1 restored')).toBeInTheDocument();
    await user.clear(proof());
    await user.type(proof(), 'plain words only');
    expect(screen.getByText('Nothing to restore')).toBeInTheDocument();
    expect(typedLine().querySelector('mark')).toBeNull();
    expect(save).not.toHaveBeenCalled();
    expect(io.snapshot()).toBe(raw);
  });

  it('follows the dictionary: a spelling added below is restored in the proof at once', async () => {
    const user = userEvent.setup();
    renderWithApp(<Dictionary />);
    await user.click(screen.getByRole('radio', { name: 'Sentence proof' }));
    await user.clear(proof());
    await user.type(proof(), 'try vox loom');
    expect(screen.getByText('Nothing to restore')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add term' }));
    await user.type(screen.getByRole('textbox', { name: 'Word' }), 'Voxloom');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(proof()).toHaveValue('try vox loom');
    expect([...typedLine().querySelectorAll('mark')].map((mark) => mark.textContent)).toEqual(['Voxloom']);
    expect(screen.getByRole('button', { name: 'Edit Voxloom' })).toBeInTheDocument();
    expect(screen.getByText('1 restored')).toBeInTheDocument();
  });

  it('hangs each spelling\'s restored forms on its row as plain, unfocusable text', () => {
    renderWithApp(<Dictionary />);
    const list = screen.getByRole('list', { name: 'Dictionary words, alphabetical' });
    const rows = within(list).getAllByRole('listitem');
    const tanstack = rows.find((row) => row.querySelector('strong')?.textContent === 'TanStack Query')!;
    expect(tanstack).toHaveTextContent('TanStack Query, restored from tan stack query, tanstack query, tan-stack query');
    expect([...tanstack.querySelectorAll('.term-row__form')].map((form) => form.textContent?.replace(/^, /, '')))
      .toEqual(['tan stack query', 'tanstack query', 'tan-stack query']);
    // The spelling inspects the specimen; the variant annotations aren't tab stops.
    expect(within(tanstack).getAllByRole('button').map((button) => button.getAttribute('aria-label')))
      .toEqual(['Inspect TanStack Query', 'Edit TanStack Query', 'Delete TanStack Query']);
    expect(tanstack.querySelector('.term-row__forms [tabindex], .term-row__forms button')).toBeNull();
    expect(screen.getByText('Restored from')).toBeInTheDocument();
  });

  it('keeps the proof and rows at AA over the stage, its glows and the new surfaces', () => {
    const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
    const lum = (rgb: number[]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
    const ratio = (a: string, b: string) => {
      const [x, y] = [lum(hex(a)), lum(hex(b))].sort((m, n) => n - m);
      return (x + 0.05) / (y + 0.05);
    };
    const mix = (a: string, b: string, t: number) => '#' + hex(a).map((v, i) => Math.round(v * t + hex(b)[i] * (1 - t)).toString(16).padStart(2, '0')).join('');
    const stage = readFileSync('src/styles/stage.css', 'utf8');
    const token = (name: string) => new RegExp(`--${name}: (#[0-9a-f]{6});`).exec(stage)![1];
    const css = readFileSync('src/styles/dictionary-stage.css', 'utf8');
    // Pin the surfaces this test measures, so a restyle has to revisit it. The
    // Dictionary stage has no dictation phase, so its glows rest at .5 and .55.
    expect(stage).toContain('color-mix(in srgb, var(--brand-a) 18%, transparent), transparent 70%); opacity: .5; }');
    expect(stage).toContain('color-mix(in srgb, var(--brand-b) 16%, transparent), transparent 70%); opacity: .55; }');
    expect(css).not.toContain('data-phase');
    expect(css).toContain('background: rgba(255, 255, 255, .04);');
    expect(css).toContain('.proof__heard:focus { background: rgba(255, 255, 255, .06);');
    expect(css).toContain('background: color-mix(in srgb, var(--brand-a) 9%, transparent);');
    expect(css).toContain('background: rgba(255, 255, 255, .025);');
    const top = '#17171f';
    const lime = '#b6ff3c';
    for (const base of [top, mix(lime, top, 0.18 * 0.5), mix('#3cf0ff', top, 0.16 * 0.55)]) {
      const surfaces = {
        deck: mix('#ffffff', base, 0.025),
        heard: mix('#ffffff', base, 0.04),
        focused: mix('#ffffff', base, 0.06),
        knot: mix(lime, base, 0.09),
      };
      for (const [name, surface] of Object.entries(surfaces)) {
        expect(ratio(token('mut'), surface), `labels, tags and placeholder on ${name} ${surface}`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(token('fg'), surface), `heard text on ${name} ${surface}`).toBeGreaterThanOrEqual(4.5);
        expect(ratio('#f6f6f9', surface), `typed line on ${name} ${surface}`).toBeGreaterThanOrEqual(4.5);
        expect(ratio(lime, surface), `restored knot and count on ${name} ${surface}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('holds the knots still under reduced motion', () => {
    const css = readFileSync('src/styles/dictionary-stage.css', 'utf8');
    const reduced = css.slice(css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toContain('.proof__knot { animation: none; }');
  });
});
