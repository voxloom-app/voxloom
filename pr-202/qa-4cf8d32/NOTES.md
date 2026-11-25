# QA voxloom #202 (light theme Frost+mint, V3 Layered) @ 4cf8d32 (tree d8f3e3bb), base main 8a9dc48
Verdict: CONDITIONAL PASS, LOW. Condition: Mac/WebKit visual check (spec §6), not runnable on box.
- Code: home-actions.css byte-identical to spec final/home-actions.css; tokens light block matches spec §2; :root dark untouched; DictateCard class, .seg__item.on color, index.css import, swatch hexes as spec.
- Box: npm ci ok; lint 0; typecheck 0; vitest 2783 passed / 2 skipped (208 files); vite build ok; e2e 90/90 (PW_PORT 1611).
- CI @4cf8d32: CI 45682563168 9/9 (incl cargo-audit), Windows 45682563338 ok, CodeQL 45682555850 5/5 incl swift. PR MERGEABLE, base main 8a9dc48 = current main.
- Renders (own build, same fixture as Dev, my dev servers): head vs Dev build-shots 0 px on all home/history/2x shots; settings differ only by fixture (cleanup on vs off).
- Dark parity vs main 8a9dc48: settings 0 px, history 0 px. Home: above Start only the selected chip (and Turn-on-cleanup link in home-off) differ; below Start with 2px shift only Copy + View all differ, plus 17 px of ±1 AA at y506-512.
- Light vs final renders: home 0, home-off 0, history 0, settings 4 px ±1. Dark: home 76 px ±2, history 5 px ±1, home-off 0, settings 0.
- States (computed, both themes): hover translateY(-1) + deeper shadow; press translateY(+1) + inset; keyboard Tab (15 tabs) :focus-visible ring 2px panel gap + 3px accfg (#376b00 light / #b6ff3c dark); disabled flat --seg, no shadow/transform, mut label; reduced motion: transition 0s, transform none on hover/press. Forced colors: 3px system outline, offset 2px.
- Stop uses same .btn.primary.big (source line 31) — same Layered look rendered.
- Turn on local cleanup: weight 600, underlined at rest and hover, no bg/shadow.
- View all: weight 600, accent color, underline on hover.
- Swatch: light #f7f9fb / border #b5bcc6, system split #f7f9fb|#0b0b10, dark unchanged.
- Contrast: Dev checker rerun 29 PASS / 0 FAIL; checker inputs match tokens.css exactly. Rendered darkest hero-glow px #cae0c1 (checker assumes #cce0c8): mut 4.54, accfg 4.58, fg 13.75 — still AA (F1 INFO; no text at that left-edge spot).
