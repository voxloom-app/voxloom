import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Dictionary } from '../../src/features/dictionary/Dictionary';
import { renderWithApp } from './testUtils';

const specimen = () => within(screen.getByRole('region', { name: 'Saved spelling specimen' }));
const inspect = (word: string) => screen.getByRole('button', { name: `Inspect ${word}` });

describe('Dictionary specimen', () => {
  it('opens on the newest spelling and inspects any row without editing the word', async () => {
    const user = userEvent.setup();
    renderWithApp(<Dictionary />);
    expect(specimen().getByRole('heading', { name: 'TypeScript' })).toBeInTheDocument();
    expect(inspect('TypeScript')).toHaveAttribute('aria-pressed', 'true');
    await user.click(inspect('JSON'));
    expect(specimen().getByRole('heading', { name: 'JSON' })).toBeInTheDocument();
    expect(specimen().getAllByRole('button')).toHaveLength(1);
    expect(inspect('JSON')).toHaveFocus();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('tests a verified form in the real, focused proof and retains typed text across views', async () => {
    const user = userEvent.setup();
    renderWithApp(<Dictionary />);
    await user.click(screen.getByRole('radio', { name: 'Sentence proof' }));
    const field = () => screen.getByRole('textbox', { name: 'Heard: try a sentence' });
    await user.clear(field());
    await user.type(field(), 'use json');
    await user.click(inspect('TypeScript'));
    await user.click(specimen().getByRole('button', { name: 'Test type-script' }));
    const proof = field();
    expect(proof).toHaveFocus();
    expect(proof).toHaveValue('type-script');
    expect(document.querySelector('#dictionary-proof-typed mark')).toHaveTextContent('TypeScript');
    await user.clear(proof);
    await user.type(proof, 'try postgres');
    await user.click(screen.getByRole('button', { name: 'Return to my sentence' }));
    expect(field()).toHaveFocus();
    expect(field()).toHaveValue('use json');
    await user.click(inspect('Postgres'));
    await user.click(screen.getByRole('radio', { name: 'Sentence proof' }));
    expect(screen.getByRole('textbox', { name: 'Heard: try a sentence' })).toHaveValue('use json');
  });

  it('never shows a missing or filtered-out word, nor hints that a variant exists without a match', async () => {
    const user = userEvent.setup();
    renderWithApp(<Dictionary />);
    const search = screen.getByRole('searchbox');
    await user.type(search, 'post');
    expect(specimen().getByRole('heading', { name: 'Postgres' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete Postgres' }));
    expect(screen.queryByRole('region', { name: 'Saved spelling specimen' })).toBeNull();
    await user.clear(search);
    await user.click(screen.getByRole('button', { name: 'Add term' }));
    await user.type(screen.getByRole('textbox', { name: 'Word' }), 'async');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(specimen().getByRole('heading', { name: 'async' })).toBeInTheDocument();
    expect(specimen().queryAllByRole('button')).toHaveLength(0);
    expect(specimen().getByText('No example variants.')).toBeInTheDocument();
  });
});
