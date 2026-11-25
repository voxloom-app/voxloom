import { useState, type RefObject } from 'react';
import { useApp } from '../../app/AppContext';
import { Switch } from '../../components/Switch';
import { isCleanupActive } from '../../domain/cleanup';
import type { CleanupModelStatus } from '../../services/cleanup/types';
import { cleanupDownloadingLabel, CLEANUP_DOWNLOAD_CANCEL } from './cleanupCopy';
import { chosenCleanupModel, qualityCleanupModel } from './cleanupModelChoice';
import {
  QUALITY_DOWNLOAD, QUALITY_HELP, QUALITY_LABEL, QUALITY_REMOVE, QUALITY_REMOVING, QUALITY_SWITCH,
  qualityModelNote, qualityRemoveFailedNote,
} from './cleanupQualityCopy';
import type { CleanupDownload } from './useCleanupDownload';
import type { CleanupModel } from './useCleanupModel';

/**
 * BUS-229: the optional Qwen3 4B row under the Cleanup model row. Shown only
 * when the native status offers the 4B, which Windows builds never do
 * (BUS-247). Choosing it writes `cleanupModelId`; Qwen3 0.6B stays the
 * default. Remove is offered once the 4B is installed and not chosen.
 */
export function CleanupQualityModel({ download, model, rowRef, status }: {
  download: CleanupDownload;
  model: Pick<CleanupModel, 'apply' | 'store'>;
  /** The block's last row, for focus when the block hides. */
  rowRef: RefObject<HTMLDivElement | null>;
  status: CleanupModelStatus;
}) {
  const { settings, state } = useApp();
  const [removing, setRemoving] = useState(false);
  const [removeNote, setRemoveNote] = useState<string | null>(null);
  const quality = qualityCleanupModel(status);
  if (!quality) return null;

  const chosen = chosenCleanupModel(status, state.settings.cleanupModelId).id === quality.id;
  const mine = download.modelId === quality.id;
  const downloading = mine && download.downloading;
  const busy = download.downloading || removing;
  const store = model.store();
  const choose = (on: boolean) => {
    settings.update({ key: 'cleanupModelId', value: on ? quality.id : status.id });
  };
  const remove = async () => {
    if (busy || !store.delete) return;
    setRemoving(true);
    setRemoveNote(null);
    try {
      model.apply(await store.delete(quality.id));
    } catch (reason: unknown) {
      setRemoveNote(qualityRemoveFailedNote(reason instanceof Error ? reason.message : String(reason)));
    } finally {
      setRemoving(false);
    }
  };

  const note = [
    qualityModelNote(quality, chosen, isCleanupActive(state.settings)),
    mine ? download.note : null,
    removeNote,
  ].filter(Boolean).join(' ');
  const noteId = 'settings-cleanup-quality-note';
  return (
    <div className="frow" ref={rowRef}>
      <span className="frow__label">
        <span>{QUALITY_LABEL}</span>
        <span className="frow__help frow__help--stack">
          <span id="settings-cleanup-quality-help">{QUALITY_HELP}</span>
          <span id={noteId} role="status">{note}</span>
        </span>
      </span>
      <span className="frow__control">
        {(quality.available || chosen) && (
          <Switch
            aria-describedby={`settings-cleanup-quality-help ${noteId}`}
            checked={chosen}
            disabled={!chosen && !quality.available}
            hideLabel
            label={QUALITY_SWITCH}
            onChange={choose}
          />
        )}
        {/* aria-disabled, not disabled: a disabled button drops focus to the body. */}
        {(!quality.available || downloading) && download.supported && (
          <button
            aria-disabled={busy}
            className="btn"
            onClick={() => { if (!busy) void download.start(quality.id); }}
            type="button"
          >
            {downloading ? cleanupDownloadingLabel(download.ratio) : QUALITY_DOWNLOAD}
          </button>
        )}
        {downloading && (
          <button className="btn" onClick={download.cancel} type="button">{CLEANUP_DOWNLOAD_CANCEL}</button>
        )}
        {quality.available && !chosen && store.delete && (
          <button aria-disabled={busy} className="btn" onClick={() => { void remove(); }} type="button">
            {removing ? QUALITY_REMOVING : QUALITY_REMOVE}
          </button>
        )}
      </span>
    </div>
  );
}
