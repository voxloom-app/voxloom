import type { ToastTone } from './Toast';

/**
 * How a thread ends, so an outcome reads by shape as well as colour (the HUD's result
 * knots, ui-iter-06): done ties a solid knot, a caveat half-ties one, and a failure
 * frays into a broken ring. Decorative: the words beside it say the same.
 */
export function Knot({ className, tone }: { className: string; tone: ToastTone }) {
  return (
    <svg aria-hidden="true" className={className} data-tone={tone} focusable="false" height="14" viewBox="0 0 14 14" width="14">
      {tone === 'ok' && <><circle cx="7" cy="7" r="5.25" /><circle className="knot__core" cx="7" cy="7" r="2.75" /></>}
      {tone === 'warn' && <><circle cx="7" cy="7" r="5.25" /><path className="knot__core" d="M7 3.5a3.5 3.5 0 0 0 0 7z" /></>}
      {tone === 'err' && <circle className="knot__fray" cx="7" cy="7" r="5.25" />}
    </svg>
  );
}
