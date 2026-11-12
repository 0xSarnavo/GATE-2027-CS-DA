# Design system v2: playful, chunky, path-based (Duolingo-inspired)

> **Owner update, 2026-10-07. This overrides the colour tokens below.**
> - **Base:** black and white only. Light mode: white bg `#FFFFFF`, ink `#0A0A0A`. Dark mode: true black `#000000` bg, raised surfaces `#111111` / `#1A1A1A`, ink `#FFFFFF`. Neutrals are greys only (`#F2F2F2`, `#E5E5E5`, `#BDBDBD`, `#757575`, `#2A2A2A`), with no blue or green tints in the greys.
> - **One accent: ORANGE.** Primary `#FF7A00`, 3D shadow edge `#CC5F00`, light tint `#FFF1E5` (dark-mode tint `#2A1606`). It replaces green as the primary colour on buttons, the current path node, progress fills, streaks and active tabs.
> - **Semantic colours, used only for feedback:** correct `#1F9D55` (shadow `#167A41`), wrong `#E5383B` (shadow `#B32B2D`), gold `#FFC800` only for completed and crown nodes.
> - Subject colour bands become **monochrome with an orange marker**. Distinguish subjects with a small icon and a label, not with many colours. Keep only a thin colour tag if needed for CS vs DA: dark ink for CS, orange outline for DA.
> - **Inspired by Duolingo, not a copy:** take the chunky 3D buttons, the learning path, CHECK followed by a feedback sheet, and the bold rounded type. The black-and-white plus orange palette and the "GATE 27" identity must make it feel like its own product.
> - **Both themes are first class:** Light, Dark and System settings, and every component checked in both.
> - **Contrast:** white on `#FF7A00` is about 2.9:1, so use 18.66px or larger bold labels on orange buttons, or black text `#0A0A0A` on orange (about 7:1, preferred for small labels).

The owner finds the current UI generic. v2 takes the *feel* of Duolingo:
- bright and friendly
- chunky 3D buttons
- bold rounded type
- a learning path of nodes
- big celebratory feedback
- streaks and goals

**Never copy Duolingo assets:** no owl or mascot, no logo, no "Duolingo" or "Duo" names, and not their proprietary Feather font. The app's identity stays "GATE 27".

## Tokens
- **Font:** **Nunito** (SIL OFL), self-hosted woff2 (weights 600/700/800/900) via `@fontsource/nunito` or files in `public/fonts`. It must work offline.
  - Titles 900, labels 800 uppercase with letter-spacing .04em, body 600/700.
- **Light theme (default):**
  - bg `#FFFFFF`, surface `#FFFFFF`, surface-2 `#F7F7F7`
  - border `#E5E5E5`, text `#3C3C3C`, muted `#777777`
- **Dark theme:**
  - bg `#131F24`, surface `#131F24`, surface-2 `#202F36`
  - border `#37464F`, text `#F1F7FB`, muted `#9AA6AD`
- **Brand colours.** Each has a "shadow" variant about 12% darker, used for the 3D bottom edge.

  | Name | Colour | Shadow | Use |
  |---|---|---|---|
  | green | `#58CC02` | `#58A700` | primary / correct / done |
  | blue | `#1CB0F6` | `#1899D6` | info / CS |
  | red | `#FF4B4B` | `#EA2B2B` | wrong |
  | orange | `#FF9600` | `#E08600` | streak |
  | gold | `#FFC800` | `#E5B400` | XP / goals |
  | purple | `#CE82FF` | `#A568CC` | DA |
  | pink | `#FF86D0` | | GA |

  - Subject colours: CS blue, DA purple, shared green, GA gold.
  - Text on the bright fills: white, or `#3C3C3C` on gold.
- **Shape:** radius 16px for cards and buttons, 999px for pills, 50% for path nodes. Borders are 2px solid `--border`.
- **Depth (signature):** a button is `border-bottom: 4px solid <shadow>` or `box-shadow: 0 4px 0 <shadow>`. On `:active`, `transform: translateY(4px)` and the shadow goes to 0. Cards get a 2px border plus `box-shadow: 0 2px 0 var(--border)`.
- **Spacing:** 4px base, 16px gutter, 24px between sections.

## Components
- **Button:**
  - primary (green with white uppercase 800 label, ≥ 48px tall, full width in action areas)
  - secondary (white with 2px border and a grey 3D edge)
  - ghost (text only)
  - danger (red)
- **Pill chips** for filters, using the same 3D edge in a small size.
- **Progress bar:** 16px tall, rounded track `--surface-2`, coloured fill with a lighter inner highlight stripe on top (2px, 30% white).
- **Path node:** a 72px circle with a 6px 3D edge and an icon or level number.
  - States: locked (grey), available (colour), current (colour plus a pulsing ring and a "START" tooltip bubble above it), done (gold with a check), crown (all mastered).
  - Nodes zig-zag left and right along a vertical path, as in a unit path.
- **Unit header:** a full-width coloured banner holding the unit (topic) name, a progress line and a "Guide" button that opens the Learn explainer cards.
- **Answer feedback sheet:** after checking, a bottom panel slides up:
  - correct: light green bg, a bold green "Nicely done!" or variant, and a green CONTINUE button;
  - wrong: light red bg, "Correct answer:" with the answer, a red GOT IT button, and links to the solution and hints.
  - While unanswered, the action button reads CHECK and is disabled until an option is chosen.
- **Option tiles:** chunky cards with a 2px border and a 3D edge. Selected = blue border and blue tint; correct = green; wrong = red.
- **Stat row (top bar):** small pills for the streak flame count (orange), daily goal or XP (gold) and cards due (blue gem-like icon), each tappable.
- **Tab bar:** 5 large icons with labels. The active tab gets a coloured icon and a rounded highlight box with a 2px border.
- **Empty and celebration states:** a big friendly SVG illustration made from simple shapes in brand colours (no mascot), a bold headline and one action. On finishing a ladder level or the daily goal, a short confetti burst (CSS/SVG, under 1s, respecting reduced motion) and a summary card.

## Screens
- **Today:**
  - stat pills;
  - a daily goal card (study minutes ring in gold);
  - an "Up next" chunky card with a START button;
  - then the timeline of tasks as cards with round check buttons.
- **Learn/Practice:**
  - **Practice home:** each subject is a section, and each topic is a unit card with a colour band, a progress bar and a "Continue Lx" button.
  - **Topic:** a unit header, then the **path** of nodes for L1–L5 (each level node opens a 5–8 question session from that level), then a "Past papers" node group (easy to hard) and a Guide (explainer cards plus animation).
- **Question session:**
  - Top: a close X, a progress bar for the session, and hearts replaced by a "hint" count.
  - Question card and option tiles, a CHECK button, then the feedback sheet.
  - At the end, a summary: accuracy, time, XP earned and mistakes added.
- **Cards and games:** the same chunky style, with flip cards having a 3D edge.
- **Plan, Log, Stats, Settings:** restyle with tokens; large list rows with icons.

## Rules
- **Accessibility:** contrast holds in both themes (white on `#58CC02` is about 2.3:1, so primary labels must be ≥ 18.66px bold, which counts as large text. Otherwise use the green-shadow `#58A700` fill or dark text). Keep focus rings, ≥ 44px targets and reduced motion.
- **Keep everything else:** all existing functionality, API calls, module structure (`web/src/modules/*`) and the Focus/Full layers stay.
- **Scrolling:** one scroll container, the document. Never put `overflow` on both html and body. Use `overflow-x: clip` on `.app`, and test that momentum scrolling works with sticky headers.
