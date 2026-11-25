# QA voxloom #202 @ 836c6772 (tree 5d378b94), base main 8a9dc48 (MERGEABLE)
Verdict: CONDITIONAL PASS, LOW. Condition: Kyle's Mac/WebKit check (steps 1-6), with step 6 corrected (F1).
Delta vs 4cf8d32 (src): home-actions.css focus rules gain :not(:disabled) (51cd7dc); new primary-layered.css (49 lines); index.css import before home.css. Plus tests + 4 e2e artifacts.
Box: npm ci ok, lint 0, tsc 0, vitest 2786 passed / 2 skipped (206 files), vite build ok, e2e 98/98 (PW_PORT 1641).
CI @836c677: CI 45715477867 9/9 (incl rust-macos, cargo-audit), CodeQL 45715469703 5/5 incl swift, Windows 45715478067 ok.
Home parity vs 4cf8d32 (own vite servers, same mock): home + home-stop, light + dark: 0 px.
Non-Home pages vs 4cf8d32: diffs only inside the primary button boxes (dictionary Add term; word Save; Done; onboarding Start setup), plus a 1px caret pixel in the word field.
States (computed + 2x crops, light and dark; Add term, Save, Done, onboarding footer, Start, Stop): rest gradient+sheen+1px inset edge; hover translateY(-1) deeper shadow; press translateY(+1) inset; Tab focus-visible ring 2px --panel gap + 3px --accfg (#376b00 light / #b6ff3c dark); ring persists under focus+hover and focus+press on all (51cd7dc behavior incl Start/Stop); disabled (attribute forced; no regular primary in Dictionary is ever disabled) = flat --seg, --mut label, no shadow/transform/transition, hover no effect. Reduced motion: transition 0s, transform none in all states. Forced colors: 3px solid system outline, no shadow/bg image.
Contrast: label #08080c vs darkest rendered face pixel 11.5:1 worst (press), 14.3 rest. Disabled --mut on --seg 5.19 light / 5.65 dark.
F1 LOW (doc): PR checklist step 6 says "disabled Add term (empty field) stays flat" but Add term and word-dialog Save have no disabled state in source (Dictionary.tsx:35, WordDialog.tsx:45); Kyle can't perform that sub-step. Disabled is verified on the box.
F2 INFO: ModelCard Retry download not rendered (needs a failed-download mock); same global selector, no local overrides in models.css.
Sheets: states-sheet-light.png, states-sheet-dark.png. Data: probe-states.json, probe-fc.json, parity.txt, contrast-rendered.txt, ci.txt.
