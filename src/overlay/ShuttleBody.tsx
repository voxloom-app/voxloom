import type { CSSProperties } from 'react';

/**
 * The HUD's body (ui-iter-06): a weaving shuttle the thread runs through, voice in
 * at the lime eyelet (left), text out at the cyan one (right). Decorative only; the
 * meter inside stays the accessible element. It stays mounted from listening through
 * transcribing so nothing jumps; level metadata changes opacity only.
 */
export function ShuttleBody({ energy }: { energy: number }) {
  return (
    <span aria-hidden="true" className="hud-shuttle" style={{ '--shuttle-energy': energy } as CSSProperties}>
      <span className="hud-shuttle__halo"><span className="hud-shuttle__band"><i className="hud-shuttle__flow" /></span></span>
      <span className="hud-shuttle__hull" />
      <span className="hud-shuttle__weft" />
      <span className="hud-shuttle__rim"><i className="hud-shuttle__flow" /></span>
      <span className="hud-shuttle__eye hud-shuttle__eye--in" />
      <span className="hud-shuttle__eye hud-shuttle__eye--out" />
    </span>
  );
}
