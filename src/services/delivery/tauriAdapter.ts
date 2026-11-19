/** Tauri bridge: native evidence is checked before it can authorize an outcome. */
import { invoke, isTauri } from '@tauri-apps/api/core';

import type { ClipboardAdapter } from '../clipboard';
import { createStubDeliveryAdapter } from './stubAdapter';
import { isInsertReport, isPasteReport } from './reports';
import { deliveryErrorDetail } from './errors';
import type {
  ClipboardSnapshot,
  DeliveryPlatformAdapter,
  InsertReport,
  PasteBinding,
  PasteReport,
  TargetSnapshot,
} from './types';
import { InsertError } from './types';

interface NativeTargetDto {
  appName: string | null;
  appPid: number | null;
  capturedAt: number;
  elementId: string | null;
  elementRole: string | null;
  insertable: boolean;
  kind: TargetSnapshot['kind'];
  knownTerminal?: boolean;
  pasteTerminal?: boolean;
  pasteApp?: string | null;
  sharedPasteToken?: string | null;
  reason: string | null;
}

function isNativeTargetDto(value: unknown): value is NativeTargetDto {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const dto = value as Record<string, unknown>;
  const nullableString = (field: unknown) => field === null || typeof field === 'string';
  return ['appName', 'elementId', 'elementRole', 'reason'].every((key) => nullableString(dto[key]))
    && (dto.appPid === null || (typeof dto.appPid === 'number' && Number.isInteger(dto.appPid) && dto.appPid > 0))
    && typeof dto.capturedAt === 'number' && Number.isFinite(dto.capturedAt)
    && typeof dto.insertable === 'boolean'
    && typeof dto.kind === 'string'
    && ['insertable', 'secure', 'unsupported', 'changed', 'closed', 'unavailable'].includes(dto.kind)
    && dto.insertable === (dto.kind === 'insertable')
    && ['knownTerminal', 'pasteTerminal'].every((key) => dto[key] === undefined || typeof dto[key] === 'boolean')
    && (dto.pasteApp === undefined || nullableString(dto.pasteApp))
    && (dto.sharedPasteToken === undefined || nullableString(dto.sharedPasteToken));
}

function fromDto(value: unknown): TargetSnapshot {
  if (!isNativeTargetDto(value)) throw new Error('native target reply malformed or contradictory');
  const dto = value;
  return {
    appName: dto.appName,
    appPid: dto.appPid,
    capturedAt: dto.capturedAt,
    elementId: dto.elementId,
    elementRole: dto.elementRole,
    insertable: dto.insertable,
    kind: dto.kind,
    knownTerminal: dto.knownTerminal ?? false,
    pasteTerminal: dto.pasteTerminal ?? false,
    pasteApp: dto.pasteApp ?? null,
    sharedPasteToken: dto.sharedPasteToken ?? null,
    reason: dto.reason,
  };
}

async function tauriClipboardRead(): Promise<ClipboardSnapshot> {
  try {
    const { readText } = await import('@tauri-apps/plugin-clipboard-manager');
    const text = await readText();
    return { ok: true, text: text ?? '' };
  } catch {
    return { ok: false, text: null };
  }
}

const SAFE_REFUSAL = 'delivery-safe-refusal:';
const CLIPBOARD_REFUSALS = [
  ['unsaved', `${SAFE_REFUSAL}clipboard-unsaved:`],
  ['changed', `${SAFE_REFUSAL}clipboard-changed:`],
] as const;

/** Only this fixed native tag proves no dispatch AND completed clipboard cleanup. */
function nativeError(error: unknown): InsertError {
  if (typeof error !== 'string' || !error.startsWith(SAFE_REFUSAL)) {
    return new InsertError(deliveryErrorDetail(error), true);
  }
  for (const [clipboard, tag] of CLIPBOARD_REFUSALS) {
    if (error.startsWith(tag)) return new InsertError(error.slice(tag.length), false, clipboard);
  }
  return new InsertError(error, false);
}

async function invokeDelivery<T>(
  command: string,
  args: Record<string, unknown>,
  valid: (value: unknown) => value is T,
): Promise<T> {
  try {
    if (!isTauri()) throw new Error('Tauri bridge unavailable');
    JSON.stringify(args);
  } catch (error: unknown) {
    throw new InsertError(deliveryErrorDetail(error), false);
  }
  let report: unknown;
  try {
    report = await invoke<unknown>(command, args);
  } catch (error: unknown) {
    throw nativeError(error);
  }
  if (!valid(report)) throw new InsertError('native delivery reply missing, malformed or contradictory', true);
  return report;
}

/** Prefer native commands under Tauri; legacy browser stubs stay explicit. */
export function createTauriDeliveryAdapter(
  clipboard: ClipboardAdapter,
): DeliveryPlatformAdapter {
  if (!isTauri()) return createStubDeliveryAdapter({ clipboard });

  const stub = createStubDeliveryAdapter({ clipboard, clipboardRead: tauriClipboardRead });
  return {
    clipboardRead: () => stub.clipboardRead(),
    clipboardRestore: (prior) => stub.clipboardRestore(prior),
    clipboardWrite: (text) => stub.clipboardWrite(text),
    async insertText(text, intended) {
      return invokeDelivery<InsertReport>('delivery_insert_text', { text, intended }, isInsertReport);
    },
    async pasteBinding() {
      try {
        if (!isTauri()) return null;
        return (await invoke<PasteBinding | null>('delivery_paste_binding')) ?? null;
      } catch {
        return null;
      }
    },
    async pasteText(text, bound) {
      return invokeDelivery<PasteReport>('delivery_paste_text', { bound, text }, isPasteReport);
    },
    async pasteTarget(text, intended) {
      return invokeDelivery<PasteReport>('delivery_paste_target', { intended, text }, isPasteReport);
    },
    async snapshotTarget() {
      try {
        return fromDto(await invoke<NativeTargetDto>('delivery_snapshot_target'));
      } catch (error: unknown) {
        const detail = deliveryErrorDetail(error);
        return stub.snapshotTarget().then((snap) => ({
          ...snap,
          reason: `native snapshot failed: ${detail}`,
        }));
      }
    },
    async validateTarget(intended) {
      try {
        return fromDto(await invoke<NativeTargetDto>('delivery_validate_target', { intended }));
      } catch (error: unknown) {
        const detail = deliveryErrorDetail(error);
        return {
          ...intended,
          insertable: false,
          sharedPasteToken: null,
          pasteTerminal: false,
          pasteApp: null,
          kind: 'unavailable',
          reason: `native validate failed: ${detail}`,
        };
      }
    },
  };
}
