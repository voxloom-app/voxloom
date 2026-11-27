// Browser-only synthetic permission/model fixtures. Not a production entry point.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useApp } from '../../src/app/AppContext';
import { Onboarding } from '../../src/features/onboarding/Onboarding';
import type { SetupBoundary } from '../../src/features/onboarding/guidedSetup';
import '../../src/styles/index.css';
const params = new URLSearchParams(location.search);
const step = Number(params.get('step') ?? 0);
const appearance = params.get('theme') ?? 'dark';
document.documentElement.dataset.appearanceResolved = appearance;
const pack = params.get('pack');
// shortcut=AltRight | Ctrl+Alt+PageDown: label variants. practice=holddone | tap | both: step 3 progress.
const shortcut = params.get('shortcut')?.split(/[+\s]+/).filter(Boolean).join(' + ') ?? 'Ctrl + Shift + Space';
const practice = params.get('practice');
const holdDone = step === 4 || ['holddone', 'tap', 'both'].includes(practice ?? '');
const tapDone = step === 4 || practice === 'both';
const mode = practice === 'tap' || practice === 'both' ? 'tap' : 'hold';
const missingReason = 'The selected voice pack is missing, downloading or not verified. Check or retry the download.';
const boundary: SetupBoundary = {
  native: true,
  // access=off: Accessibility turned off after practice (BUS-225 not-ready shots).
  query: async () => ({
    microphone: params.get('mic') === 'off' ? 'not-determined' : params.get('mic') === 'denied' ? 'denied' : 'authorized',
    accessibility: params.get('access') === 'off' ? 'not-granted' : 'authorized',
  }),
  request: async () => {}, openSettings: async () => {},
  // ready=0: the fresh-install state, voice pack not downloaded yet (BUS-224/BUS-225 shots).
  readiness: async (modelId) => {
    if (pack === 'downloading') return { modelId, ready: false, status: 'downloading', reason: missingReason };
    if (pack === 'failed') return { modelId, ready: false, status: 'missing', reason: 'Download failed: Not enough disk space. Free some space and retry.' };
    if (params.get('ready') === '0') return { modelId, ready: false, status: 'missing', reason: missingReason };
    return { modelId, ready: true, reason: null };
  },
  download: async () => {}, cancelDownload: async () => {},
  activeShortcut: () => shortcut,
};
const progress = { read: () => JSON.stringify({ version: 1, step, holdDone, tapDone, mode, modelId: 'whisper-base.en', shortcut }), write: () => {} };
/** Settings are in memory in the browser: seed the shortcut once, before setup reads its
    progress; after that the recorder owns it. */
function Preview() {
  const { settings, state } = useApp();
  const [seeded, setSeeded] = useState(state.settings.shortcut === shortcut);
  useEffect(() => {
    if (seeded) return;
    if (state.settings.shortcut === shortcut) setSeeded(true);
    else settings.update({ key: 'shortcut', value: shortcut });
  }, [seeded, settings, state.settings.shortcut]);
  return seeded ? <Onboarding boundary={boundary} onClose={() => {}} progressStorage={progress} /> : null;
}
createRoot(document.getElementById('root')!).render(<AppProvider><Preview /></AppProvider>);
