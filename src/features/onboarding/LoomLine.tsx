import { HudPreview } from '../../components/HudPreview';

/** The finish step ties off the same indicator the welcome cover introduced. */
export function LoomLine() {
  return <div aria-hidden="true" className="loom-line">
    <span className="loom-line__shuttle"><HudPreview /></span>
  </div>;
}
