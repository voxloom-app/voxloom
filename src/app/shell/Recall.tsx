import { type FocusEvent, type KeyboardEvent, type RefObject, useId, useRef, useState } from 'react';
import { Icon, type IconName } from '../../components/Icon';
import { comboLabel, isMacPlatform } from '../../components/KeyCombo';
import type { DictationRecord, HistoryStatus, Screen } from '../../domain/types';
import { dayLabel } from '../../features/history/historyLoom';
import { formatTime } from '../../features/history/HistoryRow';
import { recallMatches, recallSnippet, recallTerms } from './recallSearch';
import { navScreens } from './screens';

type Page = { combo: string; icon: IconName; label: string; screen: Screen };
const pages: Page[] = [
  ...navScreens.map((s, i) => ({ combo: `Alt+${i + 1}`, icon: s.icon, label: s.label, screen: s.value })),
  { combo: 'Alt+4', icon: 'gear', label: 'Settings', screen: 'settings' },
];

type Option = { kind: 'words'; record: DictationRecord } | { kind: 'page'; page: Page };

const statusWord: Record<HistoryStatus, string> = {
  copied: 'copied', failed: 'failed', inserted: 'inserted', unverified: 'unverified',
};
const shortDate = new Intl.DateTimeFormat('en-US', { day: 'numeric', month: 'short' });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

function when(timestamp: number, now: number): string {
  const day = dayLabel(timestamp, now);
  return day === 'Today' ? formatTime(timestamp) : day === 'Yesterday' ? day : shortDate.format(timestamp);
}

type Props = {
  records: readonly DictationRecord[];
  now: () => number;
  /** The field, so ⌘K and / can pick up the thread from anywhere in the window. */
  inputRef: RefObject<HTMLInputElement | null>;
  onCopy: (text: string) => void;
  onShow: (recordId: string) => void;
  onNavigate: (screen: Screen) => void;
};

/**
 * Recall (ui-iter-11): pick up any thread. A shuttle in the toolbar finds anything you've
 * said, newest first; Enter copies it, Shift+Enter shows it in History, and the pages are
 * one Enter away too. It is an ARIA combobox: focus stays in the field and the active
 * result is announced through aria-activedescendant.
 */
export function Recall({ records, now, inputRef, onCopy, onShow, onNavigate }: Props) {
  const base = useId();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [openedAt, setOpenedAt] = useState(0);
  // Where focus was before Recall, so closing it hands focus straight back.
  const opener = useRef<HTMLElement | null>(null);

  const terms = recallTerms(query);
  const { shown, total } = recallMatches(records, terms);
  const phrase = query.trim().toLowerCase();
  const goTo = pages.filter((page) => !phrase || page.label.toLowerCase().includes(phrase));
  const options: Option[] = [
    ...shown.map((record) => ({ kind: 'words', record }) as const),
    ...goTo.map((page) => ({ kind: 'page', page }) as const),
  ];
  const current = options.length ? Math.min(active, options.length - 1) : -1;
  const listId = `${base}-list`;
  const optionId = (index: number) => `${base}-opt-${index}`;
  const expanded = open && options.length > 0;
  const activeIsPage = options[current]?.kind === 'page';

  const wordsLabel = !terms.length ? 'Recent'
    : total > shown.length ? `${shown.length} of ${total} matches` : `${total} ${total === 1 ? 'match' : 'matches'}`;
  const summary = !open ? ''
    : !terms.length ? `${plural(shown.length, 'recent dictation')}.`
    : total ? `${plural(total, 'dictation')} found.` : 'No dictations match.';

  const close = (restore: boolean) => {
    setOpen(false);
    setQuery('');
    setActive(0);
    if (!restore) return;
    const back = opener.current;
    opener.current = null;
    if (back?.isConnected && back !== document.body) back.focus();
    else inputRef.current?.blur();
  };

  const choose = (option: Option, show: boolean) => {
    if (option.kind === 'page') {
      close(false);
      onNavigate(option.page.screen);
    } else if (show) {
      close(false);
      onShow(option.record.id);
    } else {
      onCopy(option.record.text);
      close(true);
    }
  };

  const onFocus = (event: FocusEvent<HTMLInputElement>) => {
    const from = event.relatedTarget;
    if (from instanceof HTMLElement && !from.closest('.recall')) opener.current = from;
    setOpenedAt(now());
    setOpen(true);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      close(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open) {
        setOpenedAt(now());
        setOpen(true);
      } else if (options.length) {
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setActive((current + step + options.length) % options.length);
      }
      return;
    }
    if (event.key === 'Enter' && open && current >= 0) {
      event.preventDefault();
      choose(options[current], event.shiftKey);
    }
  };

  const renderOption = (option: Option, index: number) => {
    const selected = index === current;
    const common = {
      'aria-selected': selected,
      id: optionId(index),
      onClick: (event: { shiftKey: boolean }) => choose(option, event.shiftKey),
      onMouseMove: () => { if (!selected) setActive(index); },
      role: 'option',
    } as const;
    if (option.kind === 'page') {
      return (
        <div {...common} className="recall__opt recall__opt--page" key={option.page.screen}>
          <Icon name={option.page.icon} size={14} />
          <span className="recall__words">{option.page.label}</span>
          <span aria-hidden="true" className="recall__when">{comboLabel(option.page.combo)}</span>
        </div>
      );
    }
    const { record } = option;
    return (
      <div {...common} className="recall__opt" data-status={record.status} key={record.id}>
        <i aria-hidden="true" className="recall__knot" />
        <span className="recall__words">
          {recallSnippet(record.text, terms).map((piece, at) => piece.hit
            ? <mark key={at}>{piece.text}</mark>
            : <span key={at}>{piece.text}</span>)}
        </span>
        <span className="recall__when">
          <time dateTime={new Date(record.createdAt).toISOString()}>{when(record.createdAt, openedAt)}</time>
          <span className="sr-only">, {statusWord[record.status]}</span>
        </span>
      </div>
    );
  };

  const mac = isMacPlatform();
  return (
    <div
      className="recall"
      data-open={open || undefined}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
    >
      {open && <div aria-hidden="true" className="recall__scrim" />}
      <div className="recall__shuttle">
        <span aria-hidden="true" className="recall__ring" />
        <span aria-hidden="true" className="recall__eye recall__eye--in" />
        <input
          aria-activedescendant={expanded && current >= 0 ? optionId(current) : undefined}
          aria-autocomplete="list"
          aria-controls={expanded ? listId : undefined}
          aria-describedby={`${base}-hint`}
          aria-expanded={expanded}
          aria-keyshortcuts={`${mac ? 'Meta' : 'Control'}+K /`}
          aria-label="Recall what you said"
          autoComplete="off"
          className="recall__field"
          onClick={() => {
            if (open) return;
            setOpenedAt(now());
            setOpen(true);
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
            if (!open) setOpenedAt(now());
            setOpen(true);
          }}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
          placeholder="Find anything you said"
          ref={inputRef}
          role="combobox"
          spellCheck={false}
          type="text"
          value={query}
        />
        <kbd aria-hidden="true" className="recall__key">{comboLabel('CommandOrControl+K')}</kbd>
        <span aria-hidden="true" className="recall__eye recall__eye--out" />
      </div>
      <span className="sr-only" id={`${base}-hint`}>Enter copies a dictation. Shift+Enter shows it in History.</span>
      <span aria-live="polite" className="sr-only">{summary}</span>
      {open && (
        <div className="recall__sheet">
          {shown.length === 0 && (
            <p className="recall__empty">
              {records.length ? <>Nothing you said matches “{query.trim()}”.</> : 'Nothing to recall yet. Dictate something first.'}
            </p>
          )}
          {expanded && (
            <div aria-label="Recall results" className="recall__list" id={listId} onMouseDown={(event) => event.preventDefault()} role="listbox">
              {shown.length > 0 && (
                <div aria-label={terms.length ? 'Dictations' : 'Recent dictations'} className="recall__group" role="group">
                  <div aria-hidden="true" className="recall__label">{wordsLabel}</div>
                  {options.slice(0, shown.length).map((option, index) => renderOption(option, index))}
                </div>
              )}
              {goTo.length > 0 && (
                <div aria-label="Go to" className="recall__group recall__group--pages" role="group">
                  <div aria-hidden="true" className="recall__label">Go to</div>
                  {options.slice(shown.length).map((option, index) => renderOption(option, shown.length + index))}
                </div>
              )}
            </div>
          )}
          <p aria-hidden="true" className="recall__legend">
            <span><kbd>↑</kbd><kbd>↓</kbd> Move</span>
            <span><kbd>↵</kbd> {activeIsPage ? 'Open' : 'Copy'}</span>
            {!activeIsPage && shown.length > 0 && <span><kbd>{mac ? '⇧' : 'Shift'}</kbd><kbd>↵</kbd> Show in History</span>}
            <span><kbd>esc</kbd> Close</span>
          </p>
        </div>
      )}
    </div>
  );
}
