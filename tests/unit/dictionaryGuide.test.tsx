import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dictionary } from '../../src/features/dictionary/Dictionary';
import { renderWithApp } from './testUtils';

const list = () => screen.getByRole('list', { name: 'Dictionary words, alphabetical' });
const row = (word: string) => within(list()).getAllByRole('listitem').find((item) => item.querySelector('strong')?.textContent === word)!;
const guide = () => screen.getByText('What adding a word does').closest('details')!;
/** Text a screen reader gets: aria-hidden decoration removed. */
const spoken = (element: Element) => {
  const copy = element.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
  return copy.textContent;
};

/** setup.ts answers every media query with false; say how wide the window is. */
const windowWidth = (wide: boolean) => vi.stubGlobal('matchMedia', (query: string) => ({
  addEventListener: () => {}, matches: wide && query === '(min-width: 960px)', media: query, removeEventListener: () => {},
}));

afterEach(() => { vi.unstubAllGlobals(); });

/** Revisit the page in the same app state, as a fresh mount. */
function Revisit() {
  const [visit, setVisit] = useState(0);
  return (
    <>
      <button onClick={() => setVisit((count) => count + 1)} type="button">Revisit</button>
      <Dictionary key={visit} />
    </>
  );
}

describe('Dictionary rows say what each word replaces (ui-iter-35)', () => {
  it('lists the forms the real matcher replaces, and nothing for a word already written as heard', () => {
    renderWithApp(<Dictionary />);
    expect(row('TanStack Query')).toHaveTextContent('TanStack Queryreplaces tan stack query, tanstack query, tan-stack query');
    expect(row('JSON')).toHaveTextContent(/^JJSONreplaces json$/);
    expect(within(row('TypeScript')).getAllByRole('button').map((button) => button.getAttribute('aria-label')))
      .toEqual(['Edit TypeScript', 'Delete TypeScript']);
    expect(screen.queryByRole('button', { name: /^(Inspect|Test) / })).toBeNull();
  });

  it('finds a word by what it replaces, keeping focus in the search', async () => {
    const user = userEvent.setup();
    renderWithApp(<Dictionary />);
    const search = screen.getByRole('searchbox', { name: 'Search dictionary' });
    expect(search).toHaveAttribute('placeholder', 'Search your words');
    await user.type(search, 'TYPE SCR');
    expect(within(list()).getAllByRole('listitem')).toHaveLength(1);
    expect(row('TypeScript')).toHaveTextContent('replaces type script');
    expect(search).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(within(list()).getAllByRole('listitem')).toHaveLength(4);
  });

  it('marks the word you just saved, and a new word with nothing to replace shows none', async () => {
    const user = userEvent.setup();
    renderWithApp(<Dictionary />);
    expect(document.querySelector('.term-row[data-saved]')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Add a word' }));
    await user.type(screen.getByRole('textbox', { name: 'Word' }), 'async');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(row('async')).toHaveAttribute('data-saved');
    expect(row('async').querySelector('.term-row__replaces')).toBeNull();
    expect(document.querySelectorAll('.term-row[data-saved]')).toHaveLength(1);
  });
});

describe('The guide says what adding a word does, in plain words (ui-iter-35)', () => {
  it('names the always-on fix and the two helpers, with one of your own words as the example', () => {
    windowWidth(true);
    renderWithApp(<Dictionary />);
    expect(guide()).toHaveAttribute('open');
    const steps = within(guide()).getAllByRole('listitem');
    expect(steps.map((step) => step.querySelector('strong')?.textContent))
      .toEqual(['Writes it your way', 'Helps Whisper hear it', 'Guides cleanup']);
    expect(steps[1]).toHaveTextContent('If you use Whisper');
    expect(steps[2]).toHaveTextContent('When cleanup is on');
    // The newest saved word with a form to replace.
    expect(spoken(steps[0].querySelector('.guide-fix')!)).toBe('For example, type script becomes TypeScript');
    expect(guide()).toHaveTextContent('Your words stay on this Mac.');
    expect(screen.getByRole('heading', { level: 1, name: 'Dictionary' })).toBeInTheDocument();
    expect(screen.getByText('Words and names you want Voxloom to spell your way.')).toBeInTheDocument();
  });

  it('uses none of the old jargon on the page', () => {
    renderWithApp(<Dictionary />);
    const page = document.querySelector('.dictionary')!;
    expect(page.textContent).not.toMatch(/specimen|proof|heard form|\bleaf|\bleaves|restore/i);
    for (const control of page.querySelectorAll('button, input, summary')) {
      const name = `${control.getAttribute('aria-label') ?? ''} ${control.textContent} ${control.getAttribute('placeholder') ?? ''}`;
      expect(name).not.toMatch(/specimen|proof|heard|inspect|term\b/i);
    }
  });

  it('starts closed under the list in narrow windows, unless there are no words yet', async () => {
    windowWidth(false);
    const user = userEvent.setup();
    renderWithApp(<Revisit />);
    expect(guide()).not.toHaveAttribute('open');
    await user.click(screen.getByText('What adding a word does'));
    expect(guide()).toHaveAttribute('open');
    for (const word of ['JSON', 'Postgres', 'TanStack Query', 'TypeScript']) {
      await user.click(screen.getByRole('button', { name: `Delete ${word}` }));
    }
    await user.click(screen.getByRole('button', { name: 'Revisit' }));
    expect(guide()).toHaveAttribute('open');
    expect(spoken(guide().querySelector('.guide-fix')!)).toBe('For example, vox loom becomes Voxloom');
    expect(screen.getByText('No words yet')).toBeInTheDocument();
  });
});
