# PR #204 History badge renders

Browser preview (Vite, Chromium headless), 1280x720, 1x and 2x, Light and Dark
set in Settings > Appearance. Timestamps are pinned by `render.mjs` so before and
after differ only in the badge rows.

- `before-*`: main `16aac98`, with demo fixture `record-5` set to `unverified`,
  which is how main stores a clean paste.
- `after-*`: PR head `cc3a28c` (`record-5` is `pasted` in the committed fixture),
  with demo fixture `record-6` set to `unverified` locally to show that a legacy
  unflagged row keeps its Unverified badge and note.

Fixture edits for `before` and the `record-6` edit for `after` are local to the
render run and are not in the PR.

Pasted badge contrast measured from the 2x renders: light 5.19:1
(#57606b on #e4e8ee), dark 4.95:1 (#9a9aa8 on #2c2c3a), which are the existing
`--tag-fg` / `--tag-bg` tokens also used by "Not downloaded".
