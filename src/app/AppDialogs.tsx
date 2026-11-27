import { Dialog } from '../components/Dialog';
import { Kbd, KeyCombo } from '../components/KeyCombo';
import { isTauriEnv } from '../services/capture/captureService';
import { ShortcutDemo } from './ShortcutDemo';
import { navScreens } from './shell/screens';

type ShortcutsProps = { shortcut: string; opener: HTMLElement | null; onClose: () => void };

export function ShortcutsDialog({ shortcut, opener, onClose }: ShortcutsProps) {
  return (
    <Dialog label="Keyboard shortcuts" onClose={onClose} opener={opener}>
      <h2>Keyboard shortcuts</h2>
      <div className="shortcut-guide">
        <ShortcutDemo native={isTauriEnv()} shortcut={shortcut} />
        <section aria-labelledby="window-keys-title" className="window-keys">
          <h3 id="window-keys-title">In this window</h3>
          <p className="shortcut-guide__scope">Hold <KeyCombo combo="Alt" /> and press a number to switch pages.</p>
          <ol aria-label="Page shortcuts" className="window-keys__numbers" role="list">
            {[...navScreens.map(({ label }) => label), 'Settings'].map((page, i) => (
              <li key={page}><Kbd>{String(i + 1)}</Kbd><span>{page}</span></li>
            ))}
          </ol>
          <dl className="window-keys__list">
            <div><dt>Recall a dictation</dt><dd><KeyCombo combo="CommandOrControl+K" /><span>or</span><KeyCombo combo="/" /></dd></div>
            <div><dt>Open Settings</dt><dd><KeyCombo combo="CommandOrControl+," /></dd></div>
            <div><dt>Show this sheet</dt><dd><KeyCombo combo="?" /></dd></div>
          </dl>
        </section>
      </div>
    </Dialog>
  );
}

type ResetProps = { opener: HTMLElement | null; onClose: () => void; onReset: (wipe: boolean) => void };

export function ResetSessionDialog({ opener, onClose, onReset }: ResetProps) {
  return (
    <Dialog label="Reset session" onClose={onClose} opener={opener}>
      <h2>Reset session</h2>
      <p>
        Durable history is on. Choose whether to keep <code>history.json</code>
        or wipe it. Fixture seed data is never written without an explicit wipe.
      </p>
      <div className="overlay__actions">
        <button onClick={() => onReset(false)} type="button">
          Keep durable history
        </button>
        <button className="danger" onClick={() => onReset(true)} type="button">
          Wipe durable history
        </button>
        <button onClick={onClose} type="button">Cancel</button>
      </div>
    </Dialog>
  );
}
