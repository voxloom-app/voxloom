import { useState } from 'react';
import { Dialog } from '../../components/Dialog';
import notices from '../../../src-tauri/licenses/insertion/THIRD-PARTY-NOTICES.txt?raw';

export function ThirdPartyNotices() {
  const [opener, setOpener] = useState<HTMLElement | null>(null);

  return (
    <>
      <button
        className="btn"
        onClick={(event) => setOpener(event.currentTarget)}
        type="button"
      >
        Third-Party Notices
      </button>
      {opener && (
        <Dialog label="Third-Party Notices" onClose={() => setOpener(null)} opener={opener}>
          <h2>Third-Party Notices</h2>
          <div
            aria-label="License texts"
            role="region"
            style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
            tabIndex={0}
          >{notices}</div>
          <div className="sheet-acts">
            <button className="btn" onClick={() => setOpener(null)} type="button">Done</button>
          </div>
        </Dialog>
      )}
    </>
  );
}
