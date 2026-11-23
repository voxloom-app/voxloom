import { useEffect, useRef } from 'react';
import type { HomeStyleState } from './homeStyleState';

/**
 * BUS-229: keep keyboard focus when the Home style note changes state. The
 * note's action (Turn on, Cancel, Try again) is replaced as the state moves,
 * which would drop focus to <body>. If the focused action went away, focus
 * moves to the checked style when the picker is live, otherwise to the new
 * action. Focus the user moved elsewhere is left alone.
 */
export function useHomeStyleFocus(kind: HomeStyleState, enabled: boolean) {
  const rootRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLButtonElement>(null);
  const actionFocused = useRef(false);

  useEffect(() => {
    if (!actionFocused.current) return;
    const focused = document.activeElement;
    if (focused && focused !== document.body) return;
    const target = enabled
      ? rootRef.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
      : actionRef.current;
    // A brief state with no action (a status re-read) keeps the flag, so the
    // next state can still take focus.
    if (!target) return;
    actionFocused.current = false;
    target.focus();
  }, [enabled, kind]);

  const actionFocus = {
    // A removed element blurs with no relatedTarget (or not at all), so only
    // a move to another element clears the flag.
    onBlur: (event: { relatedTarget: EventTarget | null }) => {
      if (event.relatedTarget) actionFocused.current = false;
    },
    onFocus: () => { actionFocused.current = true; },
  };
  return { actionFocus, actionRef, rootRef };
}
