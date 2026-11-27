import { useLayoutEffect, useRef, type RefObject } from 'react';
import { Icon } from '../../components/Icon';
import { STT_MODEL_CATALOG } from '../../services/stt/types';
import { permissionClear, type GuidedState, type PermissionKind } from './guidedSetup';
import { connectionPrompt, downloadIssue, genericPackReason, permissionLabel } from './connectionCopy';

const kinds = ['microphone', 'accessibility'] as const;
const names = { microphone: 'Microphone', accessibility: 'Accessibility' };

interface Props {
  guided: GuidedState;
  native: boolean;
  connected: boolean;
  heading: RefObject<HTMLHeadingElement | null>;
  modelLabel: string;
  size: string;
  error: string | null;
  permission: (kind: PermissionKind, settingsOnly?: boolean) => void;
  refresh: () => void;
  download: () => void;
  cancelDownload: (id: string) => void;
}

export function ConnectionStep({ guided, native, connected, heading, modelLabel, size, error, permission, refresh, download, cancelDownload }: Props) {
  const { permissions, modelReady, modelState, downloading, progress, checking } = guided;
  const outstanding = kinds.filter(kind => !permissionClear(permissions[kind]));
  const first = outstanding[0];
  const unknown = first && permissions[first] === 'unknown';
  const unsupported = first && permissions[first] === 'unsupported';
  const windows = permissions.accessibility === 'not-required';
  const completed = 2 - outstanding.length + Number(modelReady);
  const transferLabel = STT_MODEL_CATALOG.find(item => item.id === downloading)?.label ?? downloading;
  const { title, copy, note } = connectionPrompt(guided, first, connected, transferLabel);
  const issue = downloadIssue(guided.error);
  const packStatus = modelReady ? 'Verified' : downloading ? 'Downloading' : modelState === 'missing' ? issue ?? 'Download needed' : modelState === 'unavailable' ? 'Unavailable' : 'Not verified';
  const packInReceipt = Boolean(first || modelReady);
  const micSettingsFirst = first === 'microphone' && ['denied', 'restricted'].includes(permissions.microphone);

  // If granting access removes the button under the keyboard, resume at the new
  // instruction. A background refresh must never take focus from a surviving control.
  const lastControl = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (lastControl.current && !lastControl.current.isConnected && document.activeElement === document.body) heading.current?.focus();
  }, [heading, title, packStatus]);

  function permissionButton(kind: PermissionKind, primary: boolean) {
    return <button type="button" className={`btn${primary ? ' primary' : ''}`} disabled={!native} onClick={() => permission(kind)}>
      {kind === 'microphone' ? 'Allow Microphone' : 'Open Accessibility Settings'}
    </button>;
  }
  const micSettings = first === 'microphone' && !unknown && !unsupported && permissions.microphone !== 'not-determined' &&
    <button type="button" className={`btn${micSettingsFirst ? ' primary' : ''}`} disabled={!native} onClick={() => permission('microphone', true)}>Open Microphone Settings</button>;
  const packAction = downloading ? <button type="button" className="btn" onClick={() => cancelDownload(downloading)}>Cancel download</button>
    : modelState === 'missing' ? <button type="button" className={`btn${!first ? ' primary' : ''}`} disabled={!native || checking} onClick={download}><Icon name="download" />{issue ? 'Retry download' : 'Download voice pack'}</button> : null;
  const meter = downloading && <progress aria-label="Voice pack download" max={progress?.bytesTotal || undefined} value={progress?.bytesTotal ? progress.bytesReceived : undefined} />;
  const knownPackReason = error === genericPackReason && (modelState === 'missing' || Boolean(downloading));
  const alert = error && !knownPackReason && <p role="alert" className="form-error">{error}</p>;

  return <div className="connection" onFocusCapture={event => { lastControl.current = event.target; }}>
    <div className="connection__folio guided-kicker">01 / Get connected<span aria-hidden="true" /></div>
    <div className="connection__spread">
      <div className="connection__task guided-hero">
        <h2 id="guided-heading" ref={heading} tabIndex={-1}>{title}</h2>
        <p>{copy}</p>
        {note && <p className="connection__note">{note}</p>}
        {!packInReceipt && meter}
        <div className="connection__actions">
          {micSettingsFirst && micSettings}
          {first && !unknown && !unsupported && permissionButton(first, !micSettingsFirst)}
          {!micSettingsFirst && micSettings}
          {!packInReceipt && packAction}
          {completed < 3 && !unsupported && (!downloading || first) && <button type="button" className="btn" onClick={refresh}><Icon name="retry" />Check again</button>}
        </div>
        {(!first || !issue) && alert}
      </div>
      <div className="connection__receipt">
        <div className="connection__caption"><h3 id="connection-checks">Connection checks</h3><span>{completed} of 3</span></div>
        <ul aria-labelledby="connection-checks" role="list">
          {kinds.map(kind => <li key={kind} data-verified={permissions[kind] === 'authorized' || undefined}>
            <Icon name={kind === 'microphone' ? 'mic' : 'keyboard'} />
            <strong>{names[kind]}</strong><span>{permissionLabel[permissions[kind]]}</span>
            {kind !== first && outstanding.includes(kind) && permissions[kind] !== 'unknown' && permissions[kind] !== 'unsupported' && <div className="connection__row-action">{permissionButton(kind, false)}</div>}
          </li>)}
          <li data-verified={modelReady || undefined}><Icon name="download" /><strong>Voice pack</strong><span role={knownPackReason && !downloading ? 'alert' : undefined}>{packStatus}</span>
            <small>{modelLabel} · {size}</small>
            {transferLabel && transferLabel !== modelLabel && <small>Downloading {transferLabel}…</small>}
            {packInReceipt && meter}
            {packInReceipt && packAction && <div className="connection__row-action">{packAction}</div>}
            {first && issue && alert}
          </li>
        </ul>
        <details><summary>What happens to my voice?</summary><p>The selected speech model runs locally. The download needs internet; speech is not sent to a cloud model. Text cleanup stays off during practice.</p></details>
        {windows && <details><summary>Microphone access on Windows</summary><p>Windows has no typing permission to turn on. If Voxloom can’t hear you, open Windows Settings &gt; Privacy &amp; security &gt; Microphone and turn on Microphone access and Let desktop apps access your microphone.</p></details>}
      </div>
    </div>
  </div>;
}
