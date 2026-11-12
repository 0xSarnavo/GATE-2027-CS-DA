# Modular structure + mobile UI guidelines

Goal: turn this into a **shareable GATE CS + DA study app** that anyone can deploy as their own private copy. The owner's personal bits (their exact plan, job hunt, gym, Puja dates) become an optional, removable module. Content (questions, ladders, explainers) is a separate data pack.

## 1. Layers

```
app/
  core/                 # generic study engine: works for any user, any GATE paper set
  modules/
    planner/            # adaptive day/week planner + onboarding plan generator (generic)
    practice/           # topics, questions, ladders, hints, attempts, mistakes
    learn/              # explainers + animation player (web/src/anim moves here or is re-exported)
    review/             # flashcards (SM-2) + games
    mocks/              # full-paper tracker
    habits/             # check-ins, streaks, daily routine blocks (generic)
    jobs/               # job-search tracker (optional, off by default for new users)
  content/gate-cs-da/   # data pack: topics.json, questions, tags, ladders, explainers, external
  profiles/owner/       # THIS user's personal seed: plan.json, routine (job 8–10, gym 17–19), puja break
```
You don't need these exact folder names. The rules are what matter:
- **Module = self-contained.** It owns its server routes, its migrations (or a clearly-owned subset), its web screens, its nav entries and its settings section. A module registers itself through a small registry (`modules/index.ts` on the server, `web/src/modules/index.ts` on the web).
- **Enable or disable by config.** `app.config.json` (or env `MODULES=planner,practice,learn,review,mocks,habits`) decides what loads. Disabled modules contribute no routes, no tabs and no settings, and the core still works.
- **Core has no personal content.** No hard-coded job/gym/Puja logic and no owner's dates in core or generic modules. Anything like "gym 17:00–19:00" is a *routine block* defined in profile data that the planner reads.
- **Content pack is data only.** Its paths are configurable (`CONTENT_DIR`). The importer reads the pack, and another exam's pack could replace it.
- **Profiles:** `profiles/owner/` holds the owner's plan and routine and stays in this repo. A new user runs onboarding instead.

## 2. Onboarding (new user)
The first run with an empty DB shows a short setup. A user can be ready in about 2 minutes.
1. Choose papers: CS / DA / both.
2. Enter the exam date (default first exam weekend) and a start date.
3. Enter weekday and weekend study hours.
4. Add fixed routine blocks (optional): a list of {label, days, start, end}, for example work, gym or college.
5. Optionally add a break period, such as a festival or exams.
6. Choose which optional modules to enable (jobs tracker etc).

→ The **plan generator** (port the logic of `seed/build_plan.py` to TS in the planner module) builds phases, weekly macro goals and daily tasks from the content pack's topic order and the user's hours. The owner's existing `plan.json` stays importable as a profile, so the owner's data and plan are untouched by this refactor.

## 3. Mobile UI guidelines to follow
Follow **Apple Human Interface Guidelines** (iOS) and **Material 3** where they agree. Where they conflict, prefer iOS conventions, since the owner installs on iPhone.
- **Navigation:** bottom tab bar with up to 5 tabs on phone, and a navigation rail at 1000px or wider (already done). Tabs come from enabled modules. Use a large title on top-level screens and a compact title with back on pushed screens. Each tab keeps its own navigation stack and scroll position.
- **Touch:** targets of at least 44×44pt with 8pt spacing. Primary actions sit in the thumb zone (bottom half). Swipe actions on list rows for done/skip/move, with visible buttons as well. A sheet with a grabber is used for quick input (check-in, minutes, add card).
- **Type:** a Dynamic-Type-like scale (body 17, callout 16, footnote 13, title 28/22/20) that respects user font scaling (rem-based). Body text ≤ 70ch on wide screens.
- **Feedback:** immediate state change on tap, optimistic updates with an undo snackbar for destructive or plan changes, and skeleton loading rather than spinners where layout is known. Haptics via `navigator.vibrate` (short) on correct/wrong, and only if the user enables it.
- **States:** every list has empty, loading, error and offline states, each with one clear next action.
- **Study-app patterns:**
  - One primary "what now" action per screen.
  - Short sessions: 10–15 question sets and a 5-card review.
  - Visible progress per topic and level.
  - Spaced review queue on Today.
  - Distraction-free question mode (tab bar hidden, done).
  - Gentle streaks: no guilt messaging, and a missed day shows a plan, not a red badge.
  - Focus/Full content layers (adhd-explain).
  - Pomodoro-style optional focus timer on study tasks.
- **Accessibility:** WCAG 2.2 AA, reduced motion, and VoiceOver labels. Keep the work from `spec/06-design-review.md`.
- **Visual identity:** keep the current warm-neutral + sage palette and serif headings from the design review. No generic AI look.

## 4. Constraints for the refactor
- **Behaviour-preserving for the owner.** Same URLs, API paths (`/api/...`, documented in `server/API.md`), DB file and data. Production has real user data on a Railway volume, so new migrations must be additive and backward compatible.
- **Leave content data alone.** Content agents are writing `data/ladders/*.json` and `data/explainers/*.json` while this runs. Do not move or edit `app/data/`, and do not change importer input formats. If the content pack should live elsewhere, make the path configurable and default it to the current `app/data`.
- **Tests:** keep `bun test` green and add tests for the module registry, config enable/disable and the plan generator.
- **Docs:** README for sharing (what it is, how to deploy your own copy, onboarding, modules, content pack), and update `DEPLOY.md` and `server/API.md`.
