import { useApp } from '../../app/AppContext';
import { SegmentedControl } from '../../components/SegmentedControl';
import { isCleanupActive } from '../../domain/cleanup';
import type { WritingStyle } from '../../domain/types';
import {
  CLEANUP_DOWNLOAD, CLEANUP_DOWNLOAD_CANCEL, type CleanupModelView,
} from '../settings/cleanupCopy';
import { chosenCleanupModel, chosenModelReady } from '../settings/cleanupModelChoice';
import { useCleanupDownload } from '../settings/useCleanupDownload';
import { cleanupShown, type CleanupModel } from '../settings/useCleanupModel';
import {
  HOME_STYLE_CAPTION, HOME_STYLE_CAPTION_ON, HOME_STYLE_TRY_AGAIN, HOME_STYLE_TURN_ON,
  downloadPercent, homeDownloadId, homeStyleNote, homeStyleState,
} from './homeStyleState';
import { useHomeStyleFocus } from './useHomeStyleFocus';

const styles: { value: WritingStyle; label: string }[] = [
  { value: 'formal', label: 'Formal' },
  { value: 'casual', label: 'Casual' },
  { value: 'very-casual', label: 'Very Casual' },
];
const NOTE_ID = 'home-style-note';
/** The reason alone, so the radiogroup and action don't also read the button. */
const NOTE_TEXT_ID = 'home-style-note-text';

/** BUS-229: the Home writing-style picker and why it is disabled. */
export function HomeStyle({ isNative, model }: { isNative: boolean; model: CleanupModel }) {
  const { settings, state } = useApp();
  const update = settings.update;
  const active = isCleanupActive(state.settings);
  const download = useCleanupDownload(model);
  const { view } = model;
  const savedModelId = state.settings.cleanupModelId;
  const kind = homeStyleState({
    active, download, isNative, savedModelId, shown: cleanupShown(model, active), view,
  });
  const enabled = kind === 'browser' || kind === 'on';
  const { actionFocus, actionRef, rootRef } = useHomeStyleFocus(kind, enabled);

  if (kind === 'hidden') return null;
  const note = homeStyleNote(kind, download.ratio);
  // Same rule as the Settings switch: the chosen model must be verified and
  // have a worker, and that model's id is what gets saved.
  const turnOnWith = (modelView: CleanupModelView, modelId: string | null) => {
    if (!chosenModelReady(modelView, modelId)) return;
    update({ key: 'cleanupModelId', value: chosenCleanupModel(modelView.status, modelId).id });
    update({ key: 'cleanupOptIn', value: true });
  };
  const downloadId = homeDownloadId(view, savedModelId);
  // "Turn on local cleanup" with no model downloads it first; cleanup turns
  // on only once the download returns a verified model and a worker. The
  // download store holds that intent, so leaving Home doesn't lose it.
  const downloadAndTurnOn = () => {
    if (!downloadId) return;
    void download.start(downloadId, (status) => turnOnWith({ kind: 'status', status }, downloadId));
  };
  const action = (label: string, onClick: () => void) => (
    <button
      {...actionFocus}
      aria-describedby={NOTE_TEXT_ID}
      className="btn ghost"
      onClick={onClick}
      ref={actionRef}
      type="button"
    >
      {label}
    </button>
  );
  return (
    <div className="home-style" ref={rootRef}>
      <span className="fine">
        {kind === 'browser' || !enabled ? HOME_STYLE_CAPTION : HOME_STYLE_CAPTION_ON}
      </span>
      <SegmentedControl
        describedBy={enabled ? undefined : NOTE_TEXT_ID}
        disabled={!enabled}
        label="Current writing style"
        onChange={(value) => update({ key: 'style', value })}
        options={styles}
        value={state.settings.style}
      />
      {note && (
        <p className="hs-note" id={NOTE_ID}>
          {/* The progressbar carries the percent; announcing each one is noise. */}
          <span
            aria-live={kind === 'downloading' ? 'off' : undefined}
            id={NOTE_TEXT_ID}
            role="status"
          >
            {note}
          </span>
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
          {kind === 'off-installed' && action(HOME_STYLE_TURN_ON, () => turnOnWith(view, savedModelId))}
          {kind === 'failed' && download.supported && action(HOME_STYLE_TRY_AGAIN, downloadAndTurnOn)}
          {kind === 'on-missing' && download.supported && downloadId
            && action(CLEANUP_DOWNLOAD, () => { void download.start(downloadId); })}
        </p>
      )}
    </div>
  );
}
