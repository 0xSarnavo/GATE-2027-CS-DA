# Declutter pass: "pages are congested, not easy to understand" (owner, 2026-10-07)

**Goal:** every screen answers "what is this and what do I do here?" within 3 seconds. Keep the v2 look (black and white + orange, chunky). Remove, merge and hide things instead of restyling them.

## Rules
1. **One primary action per screen,** big and orange. Everything else is secondary (outline or text) or moves under "More".
2. **At most 3 blocks above the fold on a phone (390×844).** Anything beyond that is either below the fold, inside a collapsible "More" section, or on another screen.
3. **No stacked chip rows.** At most one filter row is visible; the other filters go in a "Filters" sheet with a count badge.
4. **Every screen starts with a one-line plain subtitle**, for example "Learn: read concepts, watch, then try a question."
5. **Progressive disclosure.** Details (stats, breakdowns, weightage, sources) sit behind a tap. Empty sections are hidden, not shown as empty boxes.
6. **Consistent page anatomy:** title, then the one-line subtitle, then the primary card, then a list. The same spacing scale everywhere, and no nested cards inside cards.
7. **Words over icons** for anything that isn't universal. No unexplained abbreviations (XP, NAT, MSQ, L1) without a tooltip or first-use label such as "L1 · Basics".

## Screen-by-screen
- **Today:**
  - Show the day's goal ring and "Up next" with START. Below it, "Later today", a compact list of the remaining blocks.
  - Move streak/XP/cards pills into one small line under the title.
  - "Today's mix", "GA daily 5", "Study next" and "Best next hours" become one "Suggested for you" card showing ONE suggestion, with "See more".
  - Check-in and "time available" go in the profile/More menu, with a gentle evening prompt card shown after 20:00 only.
- **Learn:**
  - The subject list is a simple list (name, progress, marks/paper).
  - The chapter page has 3 tabs: **Concepts** (the default: a concept list, each opening a full-screen concept reader), **Notes** (chapter note, formula sheet, my notes) and **Videos**.
  - The **concept reader** shows ONE concept at a time with Prev/Next and a progress dots bar, in v2 order: big idea → animation → worked example → check yourself, with "Go deeper" expanding Full (definition, why, how, mistake, asked).
  - Bottom bar: "Got it" and "Try a question".
- **Practice:**
  - Home = "Continue where you left off" (one card), then the subject list.
  - Topic page = the path only, with a small segmented control: Path | All questions | Mistakes. Filters only appear in "All questions", behind a Filters button.
- **Question screen:** the question, the options and CHECK. Hints are a single "Need a hint?" link. After CHECK, the feedback sheet shows the answer and one-line why, then "See full solution".
- **Test:** three big tiles (Quick test, Past paper, Full mock), then a "Recent results" list. The setup choices for each go in a sheet after tapping its tile.
- **Review:** two big tiles (Flashcards due N, Mistakes due N), then the decks list and Doubts.
- **Profile menu:** Plan, Stats, Reports, Log/Check-in, Settings. Each screen leads with a summary and puts the details behind taps.

## Also
- **v2 explainer support:** render the spec 12 fields (idea, definition, example {setup, steps, answer} as a numbered step list tied to the scene, why, how, mistake, check {q,a} with tap-to-reveal, asked footnote, chapter_note). v1 fields still render for files not yet migrated.
- **Verify** with screenshots of every screen at 390×844 in light and dark mode, before and after, and count the blocks above the fold.
