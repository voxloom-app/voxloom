/// ui-iter-19: sheets hang from the window's top edge (the toolbar's beam until ui-iter-27) and toasts are knotted tags.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Dialog } from '../../src/components/Dialog';
import { Toast } from '../../src/components/Toast';

const css = (name: string) => readFileSync(join(__dirname, '../../src/styles', name), 'utf8');
const hang = css('sheet-hang.css');
const tag = css('toast-tag.css');

describe('hanging sheet', () => {
  it('hangs the panel in cloth from a rod, with a decorative fringe below', () => {
    render(<div id="root" />);
    render(<Dialog label="Editor" onClose={() => {}} opener={null}><h2>Editor</h2></Dialog>);
    const dialog = screen.getByRole('dialog', { name: 'Editor' });
    const hangEl = dialog.querySelector(':scope > .overlay__hang')!;
    expect([...hangEl.children].map((child) => child.className)).toEqual(['overlay__rod', 'overlay__cloth', 'overlay__fringe']);
    expect(hangEl.querySelector('.overlay__rod')).toHaveAttribute('aria-hidden', 'true');
    expect(hangEl.querySelector('.overlay__fringe')).toHaveAttribute('aria-hidden', 'true');
    expect(hangEl.querySelector('.overlay__cloth > .overlay__panel')).toContainElement(screen.getByRole('button', { name: 'Close Editor' }));
  });

  it('only the dim behind the sheet dismisses it, not the rod or fringe', () => {
    const onClose = vi.fn();
    render(<Dialog label="Editor" onClose={onClose} opener={null}><h2>Editor</h2></Dialog>);
    const dialog = screen.getByRole('dialog', { name: 'Editor' });
    fireEvent.mouseDown(dialog.querySelector('.overlay__rod')!);
    fireEvent.mouseDown(dialog.querySelector('.overlay__fringe')!);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('unrolls without scrolling its focused close button, and holds still for reduced motion', () => {
    expect(hang).toMatch(/\.overlay__cloth \{[^}]*animation: cloth-unroll[^}]*overflow: clip;/);
    const reduced = hang.slice(hang.indexOf('prefers-reduced-motion'));
    expect(reduced).toMatch(/\.overlay::before, \.overlay::after, \.overlay__cloth \{ animation: none; \}/);
  });

  it('dyes its threads like the daylight frame in light appearance', () => {
    expect(hang).toContain('[data-appearance-resolved="light"] .overlay { --brand-a: #548a00; --brand-b: #008a9e; }');
    expect(css('daylight.css')).toMatch(/--brand-a: #548a00;\s*--brand-b: #008a9e;/);
  });

  it('drops from the window top in both windows: neither has a toolbar (ui-iter-27)', () => {
    expect(hang).toMatch(/\.overlay \{[^}]*--beam-y: 0px;/);
    expect(hang).not.toContain('#root:has(.settings-window-root) ~ .overlay');
  });

  it('loads after the old sheet rules and before the responsive and daylight layers', () => {
    const index = css('index.css');
    const at = (file: string) => index.indexOf(`@import "./${file}";`);
    expect(at('sheets.css')).toBeLessThan(at('sheet-hang.css'));
    expect(at('sheet-hang.css')).toBeLessThan(at('toast-tag.css'));
    expect(at('toast-tag.css')).toBeLessThan(at('responsive.css'));
  });
});

describe('knotted toast tag', () => {
  it.each([
    ['Copied to clipboard', 'ok', '.knot__core'],
    ['May have been inserted — also copied', 'warn', '.knot__core'],
    ['Copy failed', 'err', '.knot__fray'],
  ])('%s ties a %s knot', (message, tone, shape) => {
    const { container } = render(<Toast message={message} />);
    const knot = container.querySelector('.toast > svg.toast__knot')!;
    expect(knot).toHaveAttribute('data-tone', tone);
    expect(knot).toHaveAttribute('aria-hidden', 'true');
    expect(knot.querySelector(shape)).not.toBeNull();
  });

  it('hangs on a string from the window top and only fades for reduced motion', () => {
    expect(tag).toMatch(/\.toast \{[^}]*bottom: auto;[^}]*top: var\(--s-6\);/);
    expect(tag).toMatch(/\.toast::before \{[^}]*bottom: 100%;/);
    expect(tag.slice(tag.indexOf('prefers-reduced-motion'))).toContain('.toast { transition: opacity .16s ease; }');
  });
});
