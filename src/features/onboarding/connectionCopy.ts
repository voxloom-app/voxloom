import type { GuidedState, PermissionKind, PermissionState } from './guidedSetup';

export const permissionLabel: Record<PermissionState, string> = {
  authorized: 'Allowed', 'not-granted': 'Not granted', 'not-determined': 'Not requested',
  denied: 'Denied', restricted: 'Restricted', unknown: 'Not checked', unsupported: 'Unsupported',
  'not-required': 'Not needed on Windows.', unverified: 'Checked when you first dictate.',
};

// Only replace this known catch-all with the specific state the controller
// actually observed. Never swallow disk, engine, permission or save errors.
export const genericPackReason = 'The selected voice pack is missing, downloading or not verified. Check or retry the download.';

export function downloadIssue(error: string | null) {
  if (error?.startsWith('Download failed:')) return 'Download failed';
  if (error?.startsWith('Download cancelled.')) return 'Cancelled';
  return null;
}

export function connectionPrompt(guided: GuidedState, first: PermissionKind | undefined, connected: boolean, transfer: string | null) {
  if (first) {
    const state = guided.permissions[first];
    if (state === 'unknown') return { title: guided.checking ? 'Checking your setup…' : 'Check your setup.', copy: 'Voxloom checks access and the selected voice pack before you continue.' };
    if (state === 'unsupported') return { title: 'Setup is unavailable.', copy: 'Permission checks aren’t available here. Use Set up later to leave setup.' };
    if (first === 'accessibility') return {
      title: 'Turn on Accessibility.',
      copy: 'Accessibility lets Voxloom insert words, use single-key shortcuts and cancel with Esc. Under Privacy & Security → Accessibility, enable Voxloom, then return here.',
      note: 'If macOS asks you to quit and reopen Voxloom, resume setup after reopening.',
    };
    return { title: 'Allow microphone access.', copy: state === 'denied' || state === 'restricted'
      ? 'Microphone access is off. In System Settings → Privacy & Security → Microphone, allow Voxloom, then return here.'
      : 'Let Voxloom use the microphone to hear you when you dictate. Choose Allow in the permission prompt.' };
  }
  if (guided.modelReady) return {
    title: guided.permissions.accessibility === 'not-required' ? 'Ready to continue.' : 'You’re connected.',
    copy: connected ? 'Choose Continue to set your dictation shortcut.' : 'Rechecking before you continue…',
  };
  if (transfer) return { title: 'Downloading your voice pack.', copy: `${transfer} is downloading. Once verified, it can transcribe offline.` };
  if (guided.modelState === 'missing' && downloadIssue(guided.error)) return { title: 'Retry the download.', copy: 'Retry starts a fresh download of the selected voice pack.' };
  if (guided.modelState === 'missing') return { title: 'Get your voice pack.', copy: 'Download the speech model once to turn your voice into text offline.' };
  return { title: 'Check your voice pack.', copy: 'The selected model and its speech engine must be available before you continue.' };
}
