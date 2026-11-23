import { useEffect, useRef } from 'react';
import { useApp } from '../../app/AppContext';
import { SegmentedControl } from '../../components/SegmentedControl';
import { isCleanupActive } from '../../domain/cleanup';
import type { WritingStyle } from '../../domain/types';
import { CLEANUP_DOWNLOAD, CLEANUP_DOWNLOAD_CANCEL, cleanupReady } from '../settings/cleanupCopy';
import { useCleanupDownload } from '../settings/useCleanupDownload';
import { cleanupShown, type CleanupModel } from '../settings/useCleanupModel';
import {
  HOME_STYLE_CAPTION, HOME_STYLE_CAPTION_ON, HOME_STYLE_TRY_AGAIN, HOME_STYLE_TURN_ON,
  downloadPercent, homeStyleNote, homeStyleState,
} from './homeStyleState';

const styles: { value: WritingStyle; label: string }[] = [
  { value: 'formal', label: 'Formal' },
  { value: 'casual', label: 'Casual' },
  { value: 'very-casual', label: 'Very Casual' },
];
const NOTE_ID = 'home-style-note';

/** BUS-229: the Home writing-style picker and why it is disabled. */
export function HomeStyle({ isNative, model }: { isNative: boolean; model: CleanupModel }) {
  const { settings, state } = useApp();
  const update = settings.update;
  const active = isCleanupActive(state.settings);
  const download = useCleanupDownload(model);
  const { view } = model;
  const kind = homeStyleState({
    active, download, isNative, shown: cleanupShown(model, active), view,
  });
  // "Turn on local cleanup" with no model downloads it first; cleanup turns
  // on only once the download returns a verified model and a worker.
  const turnOnWhenReady = useRef(false);
  useEffect(() => {
    if (!turnOnWhenReady.current || download.downloading) return;
    if (download.note) { turnOnWhenReady.current = false; return; }
    if (!cleanupReady(view)) return;
    turnOnWhenReady.current = false;
    update({ key: 'cleanupModelId', value: view.status.id });
    update({ key: 'cleanupOptIn', value: true });
  }, [download.downloading, download.note, update, view]);

  if (kind === 'hidden') return null;
  const enabled = kind === 'browser' || kind === 'on';
  const note = homeStyleNote(kind, download.ratio);
  const downloadAndTurnOn = () => {
    turnOnWhenReady.current = true;
    void download.start();
  };
  const turnOn = () => {
    if (!cleanupReady(view)) return;
    update({ key: 'cleanupModelId', value: view.status.id });
    update({ key: 'cleanupOptIn', value: true });
  };
  const action = (label: string, onClick: () => void) => (
    <button className="btn ghost" onClick={onClick} type="button">{label}</button>
  );
  return (
    <div className="home-hero__style">
      <span className="fine">
        {kind === 'browser' || !enabled ? HOME_STYLE_CAPTION : HOME_STYLE_CAPTION_ON}
      </span>
      <SegmentedControl
        describedBy={enabled ? undefined : NOTE_ID}
        disabled={!enabled}
        label="Current writing style"
        onChange={(value) => update({ key: 'style', value })}
        options={styles}
        value={state.settings.style}
      />
      {note && (
        <p className="hs-note" id={NOTE_ID}>
          <span role="status">{note}</span>
          {kind === 'downloading' && (
            <span
              aria-label="Cleanup model download"
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={downloadPercent(download.ratio)}
              className="bar"
              role="progressbar"
            >
              <i style={{ width: `${downloadPercent(download.ratio)}%` }} />
            </span>
          )}
          {kind === 'downloading' && action(CLEANUP_DOWNLOAD_CANCEL, download.cancel)}
          {kind === 'off-missing' && download.supported && action(HOME_STYLE_TURN_ON, downloadAndTurnOn)}
          {kind === 'off-installed' && action(HOME_STYLE_TURN_ON, turnOn)}
          {kind === 'failed' && download.supported && action(HOME_STYLE_TRY_AGAIN, downloadAndTurnOn)}
          {kind === 'on-missing' && download.supported && action(CLEANUP_DOWNLOAD, () => { void download.start(); })}
        </p>
      )}
    </div>
  );
}
