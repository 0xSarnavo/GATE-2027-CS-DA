# Polish to-do (updated 2026-10-12)

Everything from the 8 Oct list is done:
- **Corner ticks:** the engine skips an x tick label that collides with a y tick label (found.functions f1/f2).
- **Bar zeros:** bars have an opt-in `hideZero`, set on 36 charts that fill in step by step. Zeros stay where they mean something (eigenvalues, SVD, errors, probabilities).
- **Step-sync:** found.series s4/s5 and found.limits_intuition l1 now have one example step per scene step. ga.quant and prob.counting were already fixed.
- **Fonts:** φ ψ ∧ ∨ → ∀ ∃ are not in the bundled Nunito subset, so they fall back to the phone's system font, which has them.
- **App:** the Plan deep link (`#/plan/calendar` or any non-date part) now opens the current week or the Calendar.

## Scenes
- **Visual check tool:** run `bunx vite web --port 5199` from `app/`, open `/src/anim/strip.html?t=<topic>` (all steps of all scenes as frames), and call `await __audit('<topic>')` in the console for measured label problems.
- **Static checker:** `bun tools/check_explainer.ts data/explainers/<topic>.json`. It also measures bar value labels now. Its remaining warnings (about 60) are estimates in chapters that pass the browser audit; trust the browser audit.
