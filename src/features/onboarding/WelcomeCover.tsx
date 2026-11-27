import { useId, useState, type Ref } from 'react';
import { HudPreview } from '../../components/HudPreview';
import { GestureGuide } from './GestureGuide';
import { WelcomeSteps } from './WelcomeSteps';

export function SetupBrand() {
  return <div className="guided-brand"><span className="guided-mark" aria-hidden="true"><i /><i /><i /></span>Voxloom</div>;
}

/** A sample, never a microphone control. Unmounting the foldout stops its trace. */
export function WelcomeCover({ heading, shortcut }: { heading: Ref<HTMLHeadingElement>; shortcut: string }) {
  const [open, setOpen] = useState(false);
  const lesson = useId();
  return <>
    <header className="welcome-imprint"><SetupBrand /><span>On-device dictation · No account</span></header>
    <div className="welcome-title" data-preview={open || undefined}>
      <h2 id="guided-heading" ref={heading} tabIndex={-1}>Less typing. <em>More you.</em></h2>
      <p>Speak naturally. Voxloom types your words where you’re writing.</p>
      <button aria-expanded={open} aria-controls={lesson} className="welcome-sample" onClick={() => setOpen(!open)} type="button">
        {!open && <span className="welcome-sample__proof" aria-hidden="true">
          <HudPreview /><i /><span>Meet me at noon.</span>
        </span>}
        <span className="welcome-sample__label">{open ? 'Close gesture preview' : 'Preview the gestures'} <b aria-hidden="true">{open ? '−' : '+'}</b></span>
      </button>
      <div className="welcome-foldout" hidden={!open} id={lesson}>{open && <GestureGuide />}</div>
    </div>
    <WelcomeSteps shortcut={shortcut} />
  </>;
}
