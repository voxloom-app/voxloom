import { comboKeys, isMacPlatform, spokenCombo } from '../../components/KeyCombo';
import { Icon } from '../../components/Icon';
import { canonicalLoneKey, isLoneFKey, loneKeyCap } from '../../services/shortcut/loneKey';
import { NOT_ACTIVE, PROMPT } from './shortcutCopy';

// A US reference, not a detected hardware layout. Ordinary chords illustrate one
// fingering; a lone right modifier must light only its own side. Give extended
// function keys their own bank rather than placing them on a laptop keyboard.
const typingRows = [
  ['`', ...'1234567890-=', 'Backspace'],
  ['Tab', ...'QWERTYUIOP[]', '\\'],
  ['Caps', ...'ASDFGHJKL;\'', 'Enter'],
  ['Shift', ...'ZXCVBNM,./', 'ShiftRight'],
];
const functionBank = ['F13', 'F14', 'F15', 'F16', 'F17', 'F18', 'F19'];
const widths: Readonly<Record<string, number>> = {
  Alt: 1.25, AltRight: 1.25, Backspace: 2, Caps: 1.75, ControlRight: 1.25,
  Ctrl: 1.25, Enter: 2.25, Meta: 1.5, MetaRight: 1.5, Shift: 2.25,
  ShiftRight: 2.75, Space: 6, Tab: 1.5, '\\': 1.5,
};
const symbols: Readonly<Record<string, string>> = {
  Backspace: '⌫', Caps: '⇪', Enter: '↵', Space: '␣', Tab: '⇥',
};
const keyWidth = (key: string) => widths[key] ?? 1;

function Diagram({ combo, extended, mac }: { combo: string; extended: boolean; mac: boolean }) {
  const selected = comboKeys(combo, mac).map((key) => key.toLowerCase());
  const bottom = mac
    ? ['fn', 'Ctrl', 'Alt', 'Meta', 'Space', 'MetaRight', 'AltRight', 'ControlRight']
    : ['Ctrl', 'Meta', 'Alt', 'Space', 'AltRight', 'MetaRight', 'ControlRight'];
  const rows = extended ? [functionBank] : [...typingRows, bottom];
  return (
    <svg aria-hidden="true" className="key-map__diagram" focusable="false" viewBox="0 0 490 166">
      <g transform={extended ? 'translate(10 65)' : 'translate(10 7)'}>
        {rows.map((row, rowIndex) => {
          const unit = 470 / row.reduce((sum, key) => sum + keyWidth(key), 0);
          let x = 0;
          return row.map((key) => {
            const width = unit * keyWidth(key) - 3;
            const at = x;
            x += width + 3;
            const cap = comboKeys(key, mac)[0];
            const plotted = selected.includes(cap.toLowerCase());
            const legend = symbols[key] ?? loneKeyCap(key, mac) ?? cap;
            return (
              <g data-key={key} data-plotted={plotted || undefined} key={key} transform={`translate(${at} ${rowIndex * 31})`}>
                <rect className="key-map__skirt" height="28" rx="4" width={width} y="2" />
                <rect className="key-map__face" height="26" rx="4" width={width} />
                <text textAnchor="middle" x={width / 2} y="17.5">{legend}</text>
                {plotted && <path className="key-map__witness" d={`M${width / 2 - 4} 22h8`} />}
              </g>
            );
          });
        })}
      </g>
    </svg>
  );
}

/** Entire plate is the recorder button. Its existing accessible name and status
 * describe the same keys; the illustration adds no focus stops or announcements. */
export function ShortcutKeyMap({ active, combo, recording }: {
  active: boolean; combo: string; recording: boolean;
}) {
  const mac = isMacPlatform();
  const extended = isLoneFKey(canonicalLoneKey(combo) ?? '');
  const names = combo.split('+').map((part) => part.trim()).filter(Boolean).map((part) => spokenCombo(part, mac));
  return (
    <span aria-hidden="true" className="key-map">
      <span className="key-map__plot">
        <span className="key-map__caption">{extended ? 'Extended function keys' : 'US key map'}<i /></span>
        <Diagram combo={active || recording ? combo : ''} extended={extended} mac={mac} />
        <span className="key-map__scale">{extended ? 'Single key' : 'Example fingering'}</span>
      </span>
      <span className="key-map__legend">
        <span className="key-map__eyebrow">{recording ? 'New shortcut' : 'Shortcut'}{!active && !recording && ` (${NOT_ACTIVE})`}</span>
        <span className="key-map__chord">
          {names.length ? names.map((name, index) => <span key={`${name}-${index}`}>{index > 0 && <i>+</i>}{name}</span>)
            : recording ? PROMPT : 'None'}
          {recording && names.length > 0 && ' …'}
        </span>
        <span className="key-map__action">{recording ? 'Esc to cancel' : <><Icon name="edit" size={14} />Change keys</>}</span>
      </span>
    </span>
  );
}
