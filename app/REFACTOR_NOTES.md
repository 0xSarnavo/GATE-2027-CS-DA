# Modular and UI refactor notes

- Server route handlers moved from `server/routes/` into `server/modules/{planner,practice,learn,review,mocks,habits,jobs}/`; shared auth, sync, admin, validation, and CRUD helpers stay in `server/`. Legacy and new migration ownership is mapped in `server/modules/MIGRATIONS.md`. `server/modules/index.ts` registers the Hono sub-apps. The web registry in `web/src/modules/index.tsx` owns lazy screen entries and bottom tabs; screens moved into their matching module folders. Settings is in `web/src/modules/core/`.
- Owner plan and Python generator moved to `profiles/owner/`, with a routine/break description there. `seed/load.ts` still imports the owner JSON shape without changing it. A new install seeds content only and uses onboarding.
- `app.config.json` is the module allowlist; `MODULES` overrides it. Settings and onboarding store database-specific switches. The included owner config enables jobs. Remove `jobs` from the allowlist, or switch it off in Settings, to hide its route and UI. Data is retained. `CONTENT_DIR` defaults to `./data`; no file under `data/` was edited or moved.
- The TypeScript planner creates phases, weekly goals, and daily tasks from paper choice, dates, hours, topic order, routines, and breaks. Onboarding inserts a plan only into an empty database. `0004_modules.sql` adds hot-query indexes without changing existing user rows. Module switches use `module.<id>` keys in the existing `settings` table, so export/import preserves them.
- The UI now has lazy module screens, larger top-level titles, per-tab route/scroll memory, task swipe actions with visible buttons, quick minute entry sheets, plan undo snackbars, a task focus timer, optional haptics, and skeleton loading. The PWA service worker cache version is derived from build assets and it precaches lazy screen JS/CSS for offline navigation.

## Verification

- `bun test`: 53 passed, 0 failed.
- `bun run typecheck`: passed.
- `bun run build`: passed.
- Fresh temporary database API check: setup created 5 weeks and 32 days; `/api/jobs` returned 404 after being disabled while `/api/questions` returned 200.

## Remaining limitations

- The legacy `0001_init.sql` and historic API response fields still contain owner-era gym/job defaults and shapes for production compatibility. New onboarding stores its own routine and hides irrelevant owner controls. Existing migrations were left untouched.
- The old Python owner plan generator remains only for regenerating the archived owner profile. New plans use the TypeScript generator; their phase/task distribution is generic rather than a byte-for-byte clone of the old personal schedule.
- A real iPhone VoiceOver and touch pass was not available in this workspace; the UI was checked by TypeScript build and source review, not device screenshots.
