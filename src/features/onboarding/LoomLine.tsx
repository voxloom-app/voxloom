import { comboKeys, Kbd } from '../../components/KeyCombo';
import { ShuttleGlyph } from '../../components/ShuttleGlyph';

/**
 * The setup loom line (ui-iter-07). On the welcome a voice thread leaves the setup rail,
 * runs under the heading into your shortcut's key caps, which press as it arrives, and on
 * into the shuttle the recording indicator draws; the braid swells and text leaves the far
 * eyelet. The finish step closes on the same line, already woven. Plays once; reduced
 * motion shows the finished line. Decorative: the copy around it says the same in words.
 */
export function LoomLine({ shortcut }: { shortcut?: string }) {
  return <div aria-hidden="true" className="loom-line">
    {shortcut && <span className="loom-line__keys">{comboKeys(shortcut).map((key, index) => <Kbd key={`${key}-${index}`}>{key}</Kbd>)}</span>}
    <span className="loom-line__shuttle"><ShuttleGlyph /></span>
  </div>;
}
