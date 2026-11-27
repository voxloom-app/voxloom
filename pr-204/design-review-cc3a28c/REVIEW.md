# Design review: voxloom PR #204, "History: label clean pastes Pasted, not Unverified"

- **Head:** `cc3a28c542d6c47fbbbc37b5c5172ff657fd117d`, one commit on main `16aac98`.
- **How I reviewed:** read-only, with plain `gh`/git and my own build of cc3a28c. The toolchain was already present, so tools-doctor wasn't needed.

## Verdict: **PASS with optional nits**
| Item | Verdict |
|---|---|
| Label "Pasted" | **PASS.** It's honest and only appears for a clean, restored paste. |
| Badge look (neutral) | **PASS.** Keep it neutral; don't use Inserted's green. |
| Sixth filter segment | **PASS.** It fits at 640px and at coarse/narrow, with no truncation or wrapping. There's one headroom nit. |

Merging is Kyle's call. The Mac on-device check that Dev lists under Untested is still owed, and so is the 640px + Large text check in nit 1.

## 1. Diff and copy
- **When "Pasted" appears:** `pastedOutcome` returns `pasted` only when `report.clipboardRestored` is true. `isPasteReport` enforces that a restored report has no skip reason.
- **What stays Unverified:**
  - A restore-skipped paste, which also keeps its "Paste sent (clipboard not restored: …)" toast.
  - IPC loss after dispatch (`mayHaveInserted`).
  - Apple Terminal Unicode dispatch, which uses the `InsertReport` route and never reaches `pastedOutcome`.
  - Any row with `mayHaveInserted`, which `createDogfoodRecord` forces to Unverified.
  - Legacy rows, which are not relabelled.
- **Strings that change:**
  - **Badge and filter:** "Pasted".
  - **docs/dictation.md:** "Voxloom pasted with ⌘V and restored your clipboard. It does not read the field back." and "…so it is Pasted, never Inserted. A paste that could not restore your clipboard stays Unverified." It also explains the legacy rows.
  - **README:** "History shows that as Pasted."
  - Code comments only otherwise.
  - The internal `detail` string ("…; input not verified") isn't shown anywhere in History.
- **How it differs from the other statuses:**
  - **Inserted** = verified by read-back.
  - **Pasted** = ⌘V posted into the re-checked app and the clipboard restored, with no read-back.
  - **Unverified** = genuinely uncertain.
  
  The docs draw the same distinction.
- **No mention of Input Monitoring** in any new or changed copy. The README's existing line 41 is untouched.
- **Consistency with FIELD_PASTE_UNVERIFIED_MESSAGE** ("May have been inserted — pasted with ⌘V; check the field"):
  - That constant isn't on main or in #204. It only exists on the unmerged BUS-223/232 branches (`fix/bus-223-insert-fallback`, `bus-232-*`; #185 is closed).
  - #204's wording uses the same vocabulary ("pasted with ⌘V", never "inserted" for a paste). ✔
  - Heads-up if BUS-223 ever lands: its ⌘V-after-AX-refusal path must stay `unverified` and must not go through `pastedOutcome`.
- **Row behaviour:** Pasted rows show no note. Copy/Delete are hidden until hover or focus (opacity 0 at rest), like Inserted. Failed and Unverified rows keep them pinned. At ≤780px and on coarse pointers they're always visible, as before. ✔

## 2. Badge semantics: keep it neutral
- **What Kyle decided:** Kyle authorised the *label* ("Build the 'Pasted' label now", quoted in the PR body). The PR has no comments or reviews, and I found no record of Kyle choosing a colour. So this is my call.
- **Not green:** green (`--ok`) is Inserted's "verified by read-back" colour. Pasted makes a weaker claim, and the docs say it is "never Inserted". Giving it green would erase the very distinction #204 exists to draw.
- **Neutral grey reads as "done, nothing to do".** It isn't a warning: warning in this system is amber (Unverified). "Not downloaded" is also neutral grey (designer #43), not a warning, so sharing `--tag-bg/--tag-fg` doesn't borrow warning semantics. The two never appear in the same list (Models vs History), and the label text always disambiguates.
- **The quiet look suits the most common status:** Pasted is the default path, so most rows will show it.
- **Contrast** (measured from computed styles, composited over the card):

| Badge | Light text/pill | Dark text/pill | Pill vs card (L / D) |
|---|---|---|---|
| Pasted (new) | **5.19** | **4.95** | 1.23 / 1.36 |
| Inserted | 5.15 | 13.19 | 1.25 / 1.01 |
| Copied | 4.57 | 13.60 | 1.25 / 1.01 |
| Failed | 4.63 | 6.82 | 1.25 / 1.01 |
| Unverified | 4.67 | 11.62 | 1.25 / 1.01 |

Dev's 5.19 / 4.95 are confirmed. All badges pass AA. In dark mode, Pasted is the quietest label, and its filled grey pill is visible where the 10% tints are not. That's acceptable for a neutral status.

- **Selected Pasted filter segment:** label 10.82:1 (light), 11.67:1 (dark).

## 3. Renders and filter checks (`renders/`)
- **Setup:** my own builds of cc3a28c (`cc3-*`) and main 16aac98 (`main-*`, a 5-segment baseline with the clean paste stored as Unverified). Mocked Tauri, clock fixed at 2026-11-27 17:40 ET.
- **History fixture:** Inserted, Pasted, Copied, Failed, legacy Unverified, and Unverified with `mayHaveInserted`.
- **Light and dark**, at 1x and 2x, at three sizes: 1120 (normal), 640 and coarse640 (touch).
- **Shots:** `-all` (full page), `-filter-all`, `-filter-pasted`, `-filter-pasted-focus` (keyboard arrow selection showing the focus ring), `-pasted-view` (filtered list), `-row-hover` and `-row-focus`.
- **Comparison sheets:** `compare-badges-2x.png`, `compare-filter-2x.png`, `compare-row-states-2x.png`.
- **Filter measurements** (`renders/meta-cc3.json`, `textsize.cjs`):

| Width | Filter width | One row | Truncated | Horizontal scroll |
|---|---|---|---|---|
| 1120 | 389 px, same row as search | ✔ | none | no |
| 640 / coarse640, default text | 389 of 420 px available | ✔ | none | no |
| 640, **Large text** (`--ts 1.12`) | 420 of 420 px | ✔ | none | **0 px headroom** |

- **Segment widths:** 35.5 to 84.7 px.
- **Segment height:** 32 px. Main's 5-segment filter is also 32 px, so this isn't new.
- 640 is the window's `minWidth` (tauri.conf).

## Nits (optional, not blocking)
1. **Filter headroom at the minimum window plus Large text is exactly 0 px** with Chromium/Linux fonts. macOS fonts may be wider. Cheap insurance, in `history.css`:
   ```css
   .history-tools .seg { flex-wrap: wrap; max-width: 100%; }
   ```
   With it, an overflow wraps inside the pill instead of clipping. Please also check 640px + Large text on the Mac.
2. **Pre-existing, separate follow-up:** filter segments are 32 px tall on coarse pointers, below the 44 px target. Suggested fix:
   ```css
   @media (pointer: coarse) { .history-tools .seg__item { min-height: 44px; } }
   ```
   Not for #204.

## 4. Heads-up: Kyle's draft #203 (09fefd7)
- **The merge itself:** a trial `git merge` of #204 into #203 (local, discarded) applies cleanly with no textual conflicts. The `Badge.tsx` `labels` → `statusLabels` rename merges fine.
- **Semantic conflicts to fix when they meet:**
  - **`History.tsx` `filterOptions`:** `const counts: Record<Filter, number> = { all, copied, failed, inserted, unverified }` is missing `pasted`. That's a **typecheck failure** after the merge. Add `pasted: 0`.
  - **`.ledger-knot` has no `pasted` rule:**
    - In rows, a Pasted knot falls back to the default solid `--ok` green dot, so it would read as Inserted.
    - In the filter, `.history-filter .ledger-knot[data-status]:not([data-status="inserted"]) { background: none; }` leaves Pasted with no border, so the knot is **invisible**.
    - It needs a neutral knot, e.g. `.ledger-knot[data-status="pasted"] { background: var(--bg); border: 2px solid var(--tag-fg); }`.
  - **No change needed:** `HistoryDayHead` / `looseThreads` count only `unverified`/`failed`, which is correct for Pasted.
  - #203's History screenshots would need Pasted rows.

## CI
Dev's local test runs (from the PR body): lint, typecheck, build, 2794 unit tests (2 skipped), 98 e2e and 1 release e2e, all passing.

Checks: everything passes except **CodeQL "Analyze (swift)"**, which fails at Autobuild (1 h 12 m). The CodeQL summary check shows NEUTRAL/skipping.
- The same failure has been on #203 since 4b4204d. CodeQL last passed on main at 16aac98.
- #204 has no Swift or Rust changes.

This isn't a design issue. I'm flagging it for RG.

## Files
- `REVIEW.md`
- `pr204-src.diff`, `pr204.json`, `pr203.json`
- `renders/` with `meta-cc3.json` and `meta-main.json`
- `compare-*.png`
- Scripts: `shoot.cjs`, `textsize.cjs`
