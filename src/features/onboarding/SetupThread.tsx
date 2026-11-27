import { comboLabel } from '../../components/KeyCombo';
import { permissionClear, type GuidedState } from './guidedSetup';
import { SETUP_STEP_TITLES } from './WelcomeSteps';

export type TieState = 'tied' | 'working' | 'open';
/** `label` is what a screen reader hears; `shows`, when set, is drawn in its place. */
export interface SetupTie { label: string; shows?: string; state: TieState }

const said: Record<TieState, string> = { tied: 'ready', working: 'in progress', open: 'not yet' };

/**
 * What each step still has to tie, read from live setup state, never from saved progress:
 * permissions and the voice pack as setup checks them, the shortcut once it is chosen,
 * and each way to dictate once its try has succeeded. The shortcut tie draws the keys but
 * is read as "Shortcut": step 2's card is where the combination is spoken, once.
 */
export function setupTies(guided: GuidedState, shortcut: string): SetupTie[][] {
  const tie = (label: string, done: boolean, working = false, shows?: string): SetupTie =>
    ({ label, shows, state: done ? 'tied' : working ? 'working' : 'open' });
  return [
    [
      tie('Microphone', permissionClear(guided.permissions.microphone)),
      tie('Accessibility', permissionClear(guided.permissions.accessibility)),
      tie('Voice pack', guided.modelReady, Boolean(guided.downloading)),
    ],
    [tie('Shortcut', guided.step > 2, false, comboLabel(shortcut))],
    [tie('Hold', guided.holdDone), tie('Double-tap', guided.tapDone)],
  ];
}

/**
 * The setup rail's thread (ui-iter-07): one thread runs down through a knot per step.
 * Finished steps are tied off, the open step glows, and the thread hangs slack below it.
 * Under each knot, small ties follow the real checks as they land.
 */
export function SetupThread({ guided, shortcut }: { guided: GuidedState; shortcut: string }) {
  const ties = setupTies(guided, shortcut);
  return <ol className="setup-thread">{SETUP_STEP_TITLES.map((label, index) => {
    const state = guided.step > index + 1 ? 'done' : guided.step === index + 1 ? 'current' : 'todo';
    return <li aria-current={state === 'current' ? 'step' : undefined} className={state === 'done' ? 'done' : ''} data-state={state} key={label}>
      <b aria-hidden="true">{state === 'done' ? '✓' : index + 1}</b>
      <span>{label}</span>
      {state === 'done' && <span className="sr-only">, done</span>}
      <small className="setup-thread__ties">{ties[index].map((item) => <em data-state={item.state} key={item.label}>
        {item.shows ? <><span aria-hidden="true">{item.shows}</span><span className="sr-only">{item.label}</span></> : item.label}
        <span className="sr-only">: {said[item.state]}</span>
      </em>)}</small>
    </li>;
  })}</ol>;
}
