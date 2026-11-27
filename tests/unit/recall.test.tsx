import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRef } from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from '../../src/app/App';
import { Recall } from '../../src/app/shell/Recall';
import { RECALL_LIMIT, recallMatches, recallSnippet, recallTerms } from '../../src/app/shell/recallSearch';
import { createRecords } from '../../src/domain/fixtures';
import { renderWithApp } from './testUtils';

const NOW = 1_800_000_000_000;
const records = createRecords(NOW);
const ids = (list: { id: string }[]) => list.map((record) => record.id);

describe('Recall search (ui-iter-11)', () => {
  it('matches every word in any order, ignoring case, newest first', () => {
    expect(recallTerms('  Retry  EXPLICIT retry ')).toEqual(['retry', 'explicit']);
    expect(ids(recallMatches(records, recallTerms('explicit RETRY')).shown)).toEqual(['record-1']);
    expect(ids(recallMatches(records, recallTerms('the')).shown)).toEqual(['record-4', 'record-5']);
    expect(recallMatches(records, recallTerms('nothing like this'))).toEqual({ shown: [], total: 0 });
  });

  it('shows the latest five before you type, and caps a long list of matches', () => {
    expect(ids(recallMatches(records, []).shown)).toEqual(['record-1', 'record-2', 'record-3', 'record-4', 'record-5']);
    const many = Array.from({ length: 12 }, (_, i) => ({ ...records[0], createdAt: NOW - i, id: `m${i}` }));
    const { shown, total } = recallMatches(many, ['retry']);
    expect(shown).toHaveLength(RECALL_LIMIT);
    expect(total).toBe(12);
    expect(shown[0].id).toBe('m0');
  });

  it('treats punctuation literally', () => {
    expect(ids(recallMatches(records, ['--filter']).shown)).toEqual(['record-2']);
    expect(ids(recallMatches(records, ['.ts']).shown)).toEqual(['record-6']);
    expect(recallMatches(records, ['(']).total).toBe(0);
  });

  it('marks every hit, longest word first, on the original text', () => {
    expect(recallSnippet('Assign the API contract review', ['the', 'api'])).toEqual([
      { hit: false, text: 'Assign ' },
      { hit: true, text: 'the' },
      { hit: false, text: ' ' },
      { hit: true, text: 'API' },
      { hit: false, text: ' contract review' },
    ]);
    expect(recallSnippet('Retry retried', ['retr', 'retried']).filter((p) => p.hit).map((p) => p.text)).toEqual(['Retr', 'retried']);
    // Lower-casing İ adds a character; matching on the original keeps the offsets true.
    expect(recallSnippet('İİİ far away', ['far'])).toEqual([
      { hit: false, text: 'İİİ ' }, { hit: true, text: 'far' }, { hit: false, text: ' away' },
    ]);
  });

  it('starts a long dictation near its first hit, and leaves short ones whole', () => {
    const long = `${'word '.repeat(30)}needle at the end`;
    const pieces = recallSnippet(long, ['needle']);
    expect(pieces[0]).toEqual({ hit: false, text: '…' });
    expect(pieces.find((p) => p.hit)?.text).toBe('needle');
    const tail = pieces.slice(1).map((p) => p.text).join('');
    expect(tail.length).toBeLessThan(long.length);
    expect(long.endsWith(tail)).toBe(true);
    expect(recallSnippet('Do not remove --dry-run from the deploy task.', ['the'])[0].text).toBe('Do not remove --dry-run from ');
  });
});

async function openApp() {
  const user = userEvent.setup();
  renderWithApp(<App />, () => NOW);
  await user.click(screen.getByRole('button', { name: 'Set up later' }));
  return user;
}
const field = () => screen.getByRole('combobox', { name: 'Recall what you said' });
const results = () => screen.getByRole('listbox', { name: 'Recall results' });
const activeOption = () => document.getElementById(field().getAttribute('aria-activedescendant') ?? '');
const currentScreen = () => within(screen.getByRole('navigation', { name: 'Voxloom screens' }))
  .getAllByRole('button').find((b) => b.getAttribute('aria-current') === 'page')?.getAttribute('aria-label');

describe('Recall in the toolbar (ui-iter-11)', () => {
  it('⌘K opens it from anywhere with your latest dictations, then the pages', async () => {
    const user = await openApp();
    expect(field()).toHaveAttribute('aria-expanded', 'false');
    expect(field()).toHaveAttribute('aria-keyshortcuts', 'Meta+K /');
    expect(field()).toHaveAccessibleDescription(/Enter copies a dictation\. Shift\+Enter shows it in History\./);
    await user.keyboard('{Meta>}k{/Meta}');
    expect(field()).toHaveFocus();
    expect(field()).toHaveAttribute('aria-expanded', 'true');
    expect(field()).toHaveAttribute('aria-controls', results().id);
    const recent = within(results()).getAllByRole('option').slice(0, 5);
    expect(recent[0]).toHaveTextContent(/^Make retry explicit.*, inserted$/);
    expect(recent[2]).toHaveTextContent(/Transcription failed before insertion\..*, failed$/);
    expect(within(results()).getByRole('group', { name: 'Recent dictations' })).toBeInTheDocument();
    const pages = within(results()).getByRole('group', { name: 'Go to' });
    for (const name of ['Home', 'History', 'Dictionary', 'Settings']) {
      expect(within(pages).getByRole('option', { name })).toBeInTheDocument();
    }
    expect(activeOption()).toBe(recent[0]);
    expect(recent[0]).toHaveAttribute('aria-selected', 'true');
  });

  it('/ opens it when you are not typing, without typing the slash', async () => {
    const user = await openApp();
    await user.keyboard('/');
    expect(field()).toHaveFocus();
    expect(field()).toHaveValue('');
    await user.keyboard('{Escape}');
    expect(field()).not.toHaveFocus();
    const other = document.createElement('input');
    document.body.append(other);
    other.focus();
    fireEvent.keyDown(other, { key: '/' });
    expect(field()).not.toHaveFocus();
    other.remove();
  });

  it('stays shut under a modal sheet, which lists its shortcut', async () => {
    const user = await openApp();
    await user.click(screen.getByRole('button', { name: 'Open keyboard shortcuts' }));
    const sheet = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
    expect(within(sheet).getByText('Recall anything you said')).toBeInTheDocument();
    fireEvent.keyDown(document.activeElement ?? document, { key: 'k', metaKey: true });
    fireEvent.keyDown(document.activeElement ?? document, { key: '/' });
    expect(field()).not.toHaveFocus();
  });

  it('filters as you type; arrows move, Enter copies and hands focus back', async () => {
    const user = await openApp();
    const opener = screen.getByRole('button', { name: 'Copy last dictation' });
    opener.focus();
    await user.keyboard('{Meta>}k{/Meta}the');
    const found = within(results()).getByRole('group', { name: 'Dictations' });
    expect(within(found).getAllByRole('option')).toHaveLength(2);
    expect([...found.querySelectorAll('mark')].map((m) => m.textContent)).toEqual(['the', 'the']);
    expect(activeOption()).toHaveTextContent('Assign the API contract review');
    await user.keyboard('{ArrowDown}');
    expect(activeOption()).toHaveTextContent('Do not remove --dry-run');
    await user.keyboard('{Enter}');
    // user-event stands in for the system clipboard.
    expect(await navigator.clipboard.readText()).toBe('Do not remove --dry-run from the deploy task.');
    await waitFor(() => expect(document.querySelector('.toast')).toHaveTextContent('Copied to clipboard'));
    expect(opener).toHaveFocus();
    expect(field()).toHaveValue('');
    expect(field()).toHaveAttribute('aria-expanded', 'false');
  });

  it('previews and copies the whole passage, not the excerpt around a deep match', async () => {
    const user = userEvent.setup();
    const text = `${'Earlier words. '.repeat(80)}\n\nThe needle is here.\nKeep this line too.`;
    let copied = '';
    render(<Recall records={[{ ...records[0], text }]} now={() => NOW} inputRef={createRef()}
      onCopy={(value) => { copied = value; }} onShow={() => {}} onNavigate={() => {}} />);
    await user.type(field(), 'needle');
    expect(activeOption()).toHaveTextContent(/^…/);
    const quote = screen.getByRole('blockquote', { name: 'Full dictation' });
    expect(quote.textContent).toBe(text);
    expect(quote.querySelector('mark')).toHaveTextContent('needle');
    await user.keyboard('{Enter}');
    expect(copied).toBe(text);
  });

  it('Shift+Enter shows the dictation in History and focuses its row', async () => {
    const user = await openApp();
    await user.keyboard('{Meta>}k{/Meta}rowan{Shift>}{Enter}{/Shift}');
    expect(currentScreen()).toBe('History');
    await waitFor(() => expect(document.activeElement).toHaveAttribute('data-record', 'record-4'));
    expect(document.activeElement).toHaveAttribute('data-recalled');
  });

  it('Enter on a page goes there; clicking a dictation reads it before an explicit copy', async () => {
    const user = await openApp();
    await user.keyboard('{Meta>}k{/Meta}dictionary');
    expect(activeOption()).toHaveTextContent('Dictionary');
    await user.keyboard('{Enter}');
    expect(currentScreen()).toBe('Dictionary');
    await user.click(field());
    await navigator.clipboard.writeText('Leave this alone while browsing');
    await user.click(within(results()).getAllByRole('option')[1]);
    const leaf = screen.getByRole('region', { name: 'Passage preview' });
    expect(within(leaf).getByRole('blockquote')).toHaveTextContent('Run pnpm test --filter transcription.');
    expect(activeOption()).toHaveAttribute('aria-selected', 'true');
    expect(await navigator.clipboard.readText()).toBe('Leave this alone while browsing');
    await user.click(within(leaf).getByRole('button', { name: /Copy passage/ }));
    expect(await navigator.clipboard.readText()).toBe('Run pnpm test --filter transcription.');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('says when nothing matches; Escape clears it, and leaving the field closes it', async () => {
    const user = await openApp();
    const opener = screen.getByRole('button', { name: 'Copy last dictation' });
    opener.focus();
    await user.keyboard('/xyz');
    expect(screen.getByText('Nothing you said matches “xyz”.')).toBeInTheDocument();
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(field()).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard('{Escape}');
    expect(opener).toHaveFocus();
    expect(field()).toHaveValue('');
    await user.click(field());
    expect(field()).toHaveAttribute('aria-expanded', 'true');
    await user.tab();
    expect(screen.getByRole('region', { name: 'Passage preview' })).toContainElement(document.activeElement as HTMLElement);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).toBeNull();
    await user.click(field());
    await user.click(screen.getByRole('button', { name: 'Home' }));
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});

describe('Recall styles (ui-iter-11)', () => {
  const css = (name: string) => readFileSync(join(__dirname, '../../src/styles', name), 'utf8');
  const recall = css('recall.css');

  it('loads right after the rail, so the frame and daylight sheets still come last', () => {
    expect(css('index.css')).toMatch(/@import "\.\/rail-loom\.css";\n@import "\.\/recall\.css";\n@import "\.\/primary-layered\.css";/);
  });

  it('keeps the sheet in place under reduced motion', () => {
    const reduced = recall.slice(recall.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(reduced).toMatch(/\.recall__scrim,\s*\.recall__sheet \{ animation: none; \}/);
    expect(reduced).toMatch(/\.history-row\[data-recalled\] \{ animation: none;/);
  });

  describe('contrast', () => {
    const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    const rgb = (s: string) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
    const lum = (s: string) => { const [r, g, b] = rgb(s).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };
    const mix = (a: string, b: string, t: number) => `#${rgb(a).map((v, i) => Math.round(v * t + rgb(b)[i] * (1 - t)).toString(16).padStart(2, '0')).join('')}`;
    const read = (source: string, name: string, after = 0) => new RegExp(`${name}:\\s*(#[0-9a-f]{6})`).exec(source.slice(after))![1];
    const daylight = css('daylight.css');
    const lightTokens = daylight.indexOf('.titlebar, .main > .banner');
    const nightCloth = read(recall, '--recall-cloth');
    const dayCloth = read(recall, '--recall-cloth', recall.indexOf('[data-appearance-resolved="light"] .recall__sheet'));
    const themes = {
      dark: { cloth: nightCloth, fg: read(css('frame.css'), '--fg'), mut: read(css('frame.css'), '--mut'), mark: read(css('tokens.css'), '--brand-a'), lime: read(css('tokens.css'), '--brand-a') },
      light: { cloth: dayCloth, fg: read(daylight, '--fg', lightTokens), mut: read(daylight, '--mut', lightTokens), mark: read(daylight, '--accfg', lightTokens), lime: read(daylight, '--brand-a') },
    };

    it('reads the cloth colours from the sheet', () => {
      expect([nightCloth, dayCloth]).toEqual(['#121219', '#ffffff']);
    });

    it.each(Object.entries(themes))('%s: words, times and matches hold AA on the sheet and the active row', (_, t) => {
      const selected = mix(t.lime, t.cloth, 0.1);
      for (const surface of [t.cloth, selected]) {
        expect(ratio(t.fg, surface)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(t.mut, surface)).toBeGreaterThanOrEqual(4.5);
        expect(ratio(t.mark, surface)).toBeGreaterThanOrEqual(4.5);
      }
    });

    it('the tab and passage read at AA on the field in both themes, with visible keyboard focus', () => {
      expect(recall).toContain('.recall__field::placeholder { color: var(--mut)');
      const fields = { dark: read(css('frame.css'), '--field'), light: read(daylight, '--field', lightTokens) };
      for (const name of ['light', 'dark'] as const) {
        for (const ink of [themes[name].mut, themes[name].fg, themes[name].mark]) {
          expect(ratio(ink, fields[name])).toBeGreaterThanOrEqual(4.5);
        }
      }
      expect(recall).toContain('.recall__tab:focus-within { outline: 2px solid var(--focus)');
      expect(recall).toContain('.recall-leaf__words:focus-visible { outline: 2px solid var(--focus)');
      expect(ratio(themes.dark.lime, '#17171f')).toBeGreaterThanOrEqual(3);
      expect(ratio(read(daylight, '--focus', lightTokens), read(daylight, '--linen'))).toBeGreaterThanOrEqual(3);
    });
  });
});
