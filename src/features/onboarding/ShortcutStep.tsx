import type { RefObject } from 'react';
import { initialSettings } from '../../domain/fixtures';
import { ShortcutRecorder } from '../settings/ShortcutRecorder';
import { GestureScore } from './GestureScore';

interface ShortcutStepProps {
  heading: RefObject<HTMLHeadingElement | null>;
  shortcut: string;
  onChange: (value: string) => void;
}

/** Step 2: your keys on the left; on the right, the two ways they work. */
export function ShortcutStep({ heading, shortcut, onChange }: ShortcutStepProps) {
  return <div className="shortcut-step">
    <div className="shortcut-step__folio"><span className="guided-kicker">02 / Make it yours</span><i aria-hidden="true" /></div>
    <div className="shortcut-step__spread">
      <div className="shortcut-step__task guided-hero">
        <h2 id="guided-heading" ref={heading} tabIndex={-1}>Your shortcut.<br />Two ways to talk.</h2>
        <p className="guided-intro">Voxloom types what you say wherever you’re writing. Keep these keys, or pick your own.</p>
        <ShortcutRecorder defaultValue={initialSettings.shortcut} id="onboarding-shortcut" onChange={onChange} value={shortcut} variant="card" />
      </div>
      <section aria-labelledby="shortcut-ways" className="shortcut-ways">
        <div className="shortcut-ways__caption"><h3 id="shortcut-ways">Two ways to use it</h3><span>You’ll try both next</span></div>
        <ul>
          <li><strong>Hold to talk</strong><span>For a quick thought.</span><GestureScore gesture="hold" /></li>
          <li><strong>Hands-free</strong><span>For longer thoughts.</span><GestureScore gesture="tap" /></li>
        </ul>
        <p className="shortcut-ways__tip"><b>One key:</b> choose Change shortcut, then press just one key, like Right Option, Right Command or F13–F19. It uses the Accessibility access you allowed in step 1. <span className="guided-settings-note">You can change this later in Settings.</span></p>
      </section>
    </div>
  </div>;
}
