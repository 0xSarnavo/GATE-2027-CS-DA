# 06 - Design review (UI pass, 7 Oct 2026)

Scope: `app/web` (Preact PWA). Reviewed every screen at 360, 390, 768 and 1280-1440 px, dark and light, against the brief: calm, ADHD-friendly (Focus layer, one clear next action), responsive, purposeful motion, not generic AI design. Screenshots live in the session scratchpad (`design-review/shots/`: `before-today-390`, `before-topic-390`, `after-today-1280`, `after-today-1440`, `after-topic-390`, `after-topic-1280`, `after-answer-light-390`).

Status key: **Fixed** = changed in this pass. **Open** = noted, not changed.

## Overall impression
Solid bones: clear tab structure, offline-first, Focus layer by default, good tap sizes on most controls. The weak spots were information order (what to do next was buried), one very long topic page, a stretched-phone desktop layout, and a generic navy/blue/purple look with blurred bars.

## Prioritised findings

### High
| # | Finding | Status |
|---|---|---|
| H1 | **Today buried the next action.** Ring + streaks + hours card + due cards pushed the first task below the fold at 390x660. Nothing said which task to do now. | Fixed. New "Now / Up next / Still to do" card at the top (current time block, else earliest open task) with a big *Mark done* button; current task also highlighted in the list and its time-block heading tinted. Progress is one compact line. Phase, streaks, check-in and available time moved to a side panel (below the list on phones, right column on desktop). |
| H2 | **Topic page was ~11,000 px tall** (concept note + 8 stacked explainer cards ~7,500 px, then the ladder). Practice was an endless scroll away. | Fixed. "Start here / Continue practising" card at the top; Learn and Practice panes (tabs on phones; defaults to Practice once you have attempted something, to Learn for a fresh topic); only the first 2 explainer cards shown, "Show the other N cards" for the rest. Page height 11,052 px to ~3,000 px. |
| H3 | **Desktop = stretched phone** (720 px column, bottom tab bar floating mid-screen). | Fixed. >=1000 px: left rail navigation, Today is two-column (list + sticky side panel), topic page is two-pane (Learn left, Practice right, sticky). 560-999 px keeps the centred single column. |
| H4 | **Contrast failures in light theme** (WCAG 1.4.3 / 1.4.11): warn/mid text 3.64:1, good text 3.30:1, muted on surface2 4.38:1, toggle off-track 1.29:1, check ring 1.69:1, input/chip borders ~1.2:1. | Fixed. New tokens verified numerically: light text 14.6:1, muted 5.0-6.0:1, accent 5.8:1, bad 6.1:1, warn 5.8:1; dark muted 6.2-7.8:1, accent 9.6:1. A `--ctl` token (>=3:1) now draws control borders, toggle tracks and check rings in both themes. |
| H5 | **Literal asterisks in question text** (`*prior*` rendered as is) and `\mid` shown as "mid" in ladder row labels ("P(diseasemidpositive test)"). | Fixed in `md.tsx` (`*italic*` supported) and `plainTeX` (`\mid \cap \cup \le \ge \ne \to \infty \frac`). |
| H6 | **Modal sheets did not manage focus** (WCAG 2.4.3, 2.1.2-adjacent): focus stayed behind the dialog, no Tab containment. | Fixed. `Sheet` focuses itself (inputs with autofocus keep it), traps Tab, restores focus on close; Escape already closed. Header menu closes on Escape and returns focus. |

### Medium
| # | Finding | Status |
|---|---|---|
| M1 | Generic look: navy/blue accent, purple (DA scope, plan phase 2, `#b47cf0`/`#c58bff`), translucent blurred header, tab bar and action bar (glassmorphism). | Fixed. Warm neutral palette in both themes, single sage accent, no purple anywhere, opaque bars, serif (system `ui-serif` stack, no download) for headings and key numbers. Scope colours: CS blue, DA sage, GA amber. |
| M2 | Tap targets under 44 px: chips/seg/`btn.sm` 40, icon-btn.sm 40, plan goal check 36, animation step dots 28, pill 30. | Fixed (all >=44, dots 32x44 in `anim.css`). Open: plan timeline week ticks (2-4 px visual, ~22 px hit area); the Previous/Next week buttons are the equivalent 44 px control, so WCAG 2.5.8 is met via the alternative. |
| M3 | Focus ring 2 px, same accent as selected chips (invisible on `.chip.on`, `.btn.primary`). | Fixed. 3 px ring, switches to text colour on filled accent controls. `scroll-padding` added so a sticky header/bar never hides the focused element (2.4.11). |
| M4 | `Seg` used `role=tablist/tab` with no tabpanels or arrow-key handling (4.1.2). | Fixed. Plain group of `aria-pressed` buttons. |
| M5 | No skip link; page title never changed between screens (2.4.1, 2.4.2). | Fixed. "Skip to content" link, `<title>` follows the screen heading, focus parked on `<main>` per route. |
| M6 | Colour-only state in Practice and answers: topic accuracy dot, correct/wrong option borders (1.4.1). | Fixed. Dot has an accessible text (`72% correct` / `Not started`); revealed options show a check / cross glyph in the key badge plus screen-reader text ("correct answer", "your answer, incorrect"). |
| M7 | After answering, the verdict sat below the fold and the user had to hunt for it. | Fixed. Verdict scrolls into view (instant under reduced motion). Timer now `role=timer` with readable label. |
| M8 | Practice list: 20+ empty progress bars, and "Mistakes review" card showing only a flag icon. | Fixed. Bars appear only once a topic is started; the row states the count ("3 mistakes to revise today") or "nothing due today". |
| M9 | Plan timeline legend listed all six phases with only four colours (two pairs identical). | Fixed. Legend shows only the current week's phase with its date range; colours remain tokens (no purple). |
| M10 | Motion inconsistent (.1s to .5s, mixed easings); reduced-motion rule only shortened durations. | Fixed. `--ease/--d1..d3` tokens, one entrance (`rise`), checkmark draw on tick, tab indicator slide, "now" dot pulse. Reduced motion: 0.01 ms, 1 iteration, no smooth scroll, spinner becomes a static ring. |
| M11 | Desktop sheets/toasts/actionbar anchored to a phone-width box. | Fixed (sheet max 560, toast bottom-left of content, actionbar stays in the centred 720 px reading column on fullscreen routes). |

### Low / open
- L1 Today "Mark done" marks the whole task done (est. minutes). A partial-minutes option exists only in the task menu. Open.
- L2 Question header truncates the title at 34 characters; fine on phones, wasteful on desktop. Open.
- L3 Explainer cards (`src/anim/Cards.tsx`) have no per-card jump or progress; limited by the "leave anim internals alone" rule. The 2-card cap above mitigates it. Open.
- L4 Stats and Log are dense forms/charts but readable and overflow-free at 360 px; no restructuring done. Open.
- L5 Theme follows the OS only; no manual toggle in Settings. Open (the CSS already supports `data-theme="dark"` as an override hook).
- L6 Lighthouse accessibility was not run (Chrome DevTools MCP unavailable); audit was manual (keyboard, accessible names, contrast maths, overflow/target scan at 360 px).

## Accessibility summary (WCAG 2.2 AA)
| SC | Result |
|---|---|
| 1.4.1 Use of colour | Fixed (M6) |
| 1.4.3 / 1.4.11 Contrast | Fixed (H4); all text >=4.5:1, control boundaries >=3:1 in both themes |
| 1.4.10 Reflow (360 px) | Pass: no horizontal scroll on Today, Plan, Practice, topic, Cards, Log, question |
| 2.1.1 / 2.1.2 Keyboard | Pass; dialogs now trap and restore focus (H6) |
| 2.3.3 / 2.2.2 Motion | Reduced-motion honoured globally and by the animation player |
| 2.4.1 / 2.4.2 / 2.4.3 / 2.4.7 / 2.4.11 | Fixed (M3, M5, H6) |
| 2.5.8 Target size (min) | Pass; 44 px target met except noted timeline ticks (M2) |
| 3.3.1 Error identification | Login error is `role=alert` and the field gets `aria-invalid` |
| 4.1.2 Name, role, value | Segmented controls fixed (M4); menu button names what is inside |

## Copy review (ux-copy)
Rule used: name the object, say what happens, no blame, no jargon, same word for the same thing.

| Before | After |
|---|---|
| "Hours available today" (value shown as "6h 30m") | "Time available today" |
| "Apply" / "Rescaling..." | "Update today's plan" / "Updating plan..." |
| "The plan rescales: low-priority work moves later..." | "Lower-priority tasks move to later days if you have less time, and come forward if you have more." |
| "Nothing planned for today. Enjoy the rest, or add tasks in Plan." | Title "Nothing planned today" + "Take the day off, or add a task from the Plan tab." |
| "Tap to tick. Long-press or use the menu to skip, move or edit." | "Tap a task to tick it. Long-press or use the dots to skip, move or edit." |
| "Couldn't load: {error}" / "Retry" | "Couldn't load this" + offline hint when relevant / "Try again" |
| "Wrong password" / "Cannot reach server" | "That password did not work. Check it and try again." / "Can't reach the server. Check your connection and try again." |
| "Too many attempts. Try again later." | "Too many attempts. Wait a few minutes, then try again." |
| "No mistakes due today." | "Nothing to revise today. Questions you get wrong come back here after 1 day, 1 week and 3 weeks." |
| "Review done. Nice work." | "Revision done. Those mistakes are scheduled to come back later." |
| Practice "Mistakes review" (icon only) | "3 mistakes to revise today" / "Mistakes: nothing due today" |
| "Hint 1 of 3" button | "Stuck? Show a hint", then "Show hint 2 of 3" |
| "Done" (end of queue) | "Finish" |
| "What went wrong? (adds it to Mistakes)" | "What went wrong? Picking one adds it to your Mistakes revision." |
| "Session complete" / "No cards due. Come back later." / "Done" | "Session complete: N remembered, M coming back soon." / "New cards appear here as they fall due." / "Back to Cards" |
| "Tap to reveal" under a card that also has a Show answer button | "Tap the card to flip it" |
| "New version available. Tap to reload" | "Update ready. Tap to restart the app" |
| Header menu aria-label "Menu" | "More: stats, mistakes, settings" |

## What was kept (works well)
Focus layer default and per-section Show more; ladder ordering with a suggested next question; offline queue and sync pill; long-press task menu with a visible dots alternative; large, thumb-reachable action bar on question screens; the explainer player (steps, dots, swipe, keyboard).

## Files touched
`web/src/styles.css` (tokens, scale, layout, motion), `web/src/anim/anim.css` (dot hit area, serif title, focus ring only), `ui.tsx`, `main.tsx`, `md.tsx`, `tasks.tsx`, `screens/Today.tsx`, `Practice.tsx`, `Question.tsx`, `Plan.tsx`, `Mistakes.tsx`, `Cards.tsx`. No dependencies added, no API changes.
