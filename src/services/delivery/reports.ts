/** Runtime evidence checks: TypeScript types cannot validate an IPC response. */
import type { InsertReport, PasteReport } from './types';

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function nullableString(value: unknown): boolean {
  return value === null || typeof value === 'string';
}

export function isInsertReport(value: unknown): value is InsertReport {
  if (!object(value) || typeof value.typed !== 'boolean'
    || typeof value.unverified !== 'boolean' || !nullableString(value.detail)
    || Object.keys(value).some((key) => !['typed', 'unverified', 'detail', 'terminalDispatch'].includes(key))) {
    return false;
  }
  if (!('terminalDispatch' in value)) return true;
  return (value.terminalDispatch === 'complete' || value.terminalDispatch === 'partial')
    && value.typed && value.unverified;
}

export function isPasteReport(value: unknown): value is PasteReport {
  return object(value) && typeof value.clipboardRestored === 'boolean'
    && nullableString(value.restoreSkippedReason)
    && (!value.clipboardRestored || value.restoreSkippedReason === null)
    && Object.keys(value).every((key) => ['clipboardRestored', 'restoreSkippedReason'].includes(key));
}
