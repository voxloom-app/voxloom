# #202 re-review at 836c6772cb8a8a5eabbee8d3c99e6c435ef9d426 (tree 5d378b94): V3 Layered on regular primaries

**Verdict: PASS.** No changes are requested, and there's one optional nit below. Merge is Kyle's call, and the Mac/WebKit check is still owed.

## Claims verified (plain `gh`/git, read-only)
| Claim | Result |
|---|---|
| Head SHA | `gh pr view 202` reports headRefOid `836c6772cb8a8a5eabbee8d3c99e6c435ef9d426`, tree `5d378b940fee…`, parent `51cd7dc`. OPEN, MERGEABLE. ✔ |
| primary-layered.css byte-identical to the addendum | `cmp` matches, sha256 `3d296087…eaebeaee` on both. ✔ |
| Import order | `shell.css` → `primary-layered.css` → `home.css` → `home-actions.css`. ✔ |
| 51cd7dc intact | `git diff 51cd7dc 836c677 -- home-actions.css home.css` is empty. Both `:focus-visible:not(:disabled)` rules are present. ✔ |
| Tests | `frostMintTheme`: +3 tests (import order regex, `:not(:disabled)` scoping where only `.btn.primary` with `transition: none` is exempt, under 200 lines). `focusRingHover.spec`: refactored into `assertRingPersists`; covers `.btn primary big` and plain `.btn primary` in light and dark; disabled primary and `.big` have `box-shadow: none`, `background-image: none` and bg = `--seg`; secondary and ghost have no gradient; `.big` keeps 42px, 9px 18px padding, 1px border and its own shadow signature. ✔ |
| Baselines | Only the Dictionary set changed: `baseline-dictionary-{dark,light,system}.png` and `dictionary-coarse-narrow.png`. No Home baselines changed. ✔ |
| Unit tests | Local `vitest` at 836c677: 2786 passed, 2 skipped. ✔ |
| CI | 16/16 SUCCESS, including browser-app, browser-release, windows-x64, rust-macos, cleanup-worker (macos) and CodeQL. ✔ |

## Renders
I used my own build of 836c677 with the mocked Tauri layer and a fixed clock. Renders are in `mine/renders/`:
- **1x full windows:** `r836-<view>-{light,dark}-1x.png`
- **2x crops:** `r836-<view>-{light,dark}-2x-{rest,hover,focus,focus-hover}.png`
- **Views:** dictionary (Add term), word (Save), done (Shortcuts Done), onboarding (**step 0 with "Start setup →" enabled**, `disabled: false` in `meta-r836.json`), models (Settings window → Models with a failed Whisper Base → **ModelCard Retry download `.btn.primary`**), onboarding-step1 (context for the Retry decision), home and home-stop.
- **Overview sheet:** `mine/compare-836c677-2x.png`

Pixel results (`mine/parity.txt`):
- **836c677 vs the addendum prototype:** 0 px on all 80 shots of every view and state. The one exception is `onboarding-step1-dark-1x`, which differs only in the left rail (24,34)-(55,223). That's a step-indicator timing artifact, and it also shows up against 51cd7dc. It isn't a button.
- **836c677 vs 51cd7dc, Home and Home-stop:** 0 px at 1x and at 2x rest, hover, focus and focus+hover, light and dark. Start/Stop is unchanged.
- **836c677 vs 51cd7dc, other views:** the diffs are confined to the regular primary button areas.
- **Dev's renders vs mine:** Dictionary and word are 0 px. Onboarding is 0 px at 2x; at 1x the only difference is one WelcomeSteps text line (241,470)-(610,483), which is mock nondeterminism.
- **Onboarding CTA in Dev's renders:** his onboarding renders *do* show the CTA enabled. Only the committed e2e `onboarding.png` baseline has it disabled, because the browser build isn't native.
- **Geometry:** unchanged. Everything is 36px except the onboarding CTA at 42px. Labels are #08080c on the gradient: worst stop 14.38:1, pressed 8.86:1.

Visual check:
- Shadows sit cleanly in the dialog footers.
- The focus ring stays on under hover in light and dark.
- The dark shadows are tight.
- Retry download in Settings reads correctly as the card's one recovery action.

## Onboarding "Retry download": leave it as plain `btn`
Step 1 already has its primary in the footer (Continue →), and Retry sits in the voice-pack card next to plain `btn` fix-it actions (Allow Microphone, Open Accessibility Settings), so promoting it would put two primaries on one screen. See `r836-onboarding-step1-light-1x.png`.

The Settings ModelCard Retry *is* the card's only action in its failed state. It's already `btn primary`, and it renders correctly.

## Nits (optional, not blocking)
1. Neither the word dialog nor the Shortcuts sheet has a committed e2e baseline. If you want regression cover, consider adding a `word-dialog` and a `shortcuts-sheet` screenshot later. This isn't needed for #202.

## Still owed
A Mac/WebKit visual check of Start/Stop and the regular primaries in light and dark, including focus+hover. Merge is Kyle's call.
