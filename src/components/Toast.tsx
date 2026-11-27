import { Knot } from './Knot';

export type ToastTone = 'ok' | 'warn' | 'err';

interface ToastProps {
  message: string;
  tone?: ToastTone;
}

/**
 * Infer severity from the app's real strings (SPEC: toast gets an icon by
 * severity). Errors: failures, in-use shortcuts, expired buffers, retry guard.
 * Warnings: copied fallback, unverified or uncertain inserts.
 */
export function toastTone(message: string): ToastTone {
  if (/fail|couldn|can’t|can't|error|expired|in use|finish the current|unable|denied|nothing transcribed/i.test(message)) {
    return 'err';
  }
  if (/not verified|unverified|may have|also copied|^copied —|inspect|clipboard not restored/i.test(message)) return 'warn';
  return 'ok';
}

/**
 * A tag that drops on a string from the toolbar beam, under Recall, and is tied off with
 * the HUD's knots, so severity reads by shape as well as colour (ui-iter-19). It hangs
 * over the page's header, never over the rows you are working in. Announced politely;
 * timings live in useToastMessages.
 */
export function Toast({ message, tone = toastTone(message) }: ToastProps) {
  return (
    <div aria-live="polite" className={`toast t-${tone}${message ? ' visible' : ''}`}>
      {message && <Knot className="toast__knot" tone={tone} />}
      {message && tone === 'err' && <span className="sr-only">Error: </span>}
      {message}
    </div>
  );
}
