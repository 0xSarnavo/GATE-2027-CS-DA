# Section A analytics implementation

## Built

- Additive `0006_analytics.sql` migration for daily concept mastery, doubts, reports, push subscriptions and delivery deduplication, speed drill bests, curated video metadata, and concept timestamps. The `insights` module is registered in `app.config.json` and both module registries. Existing routes and fields remain available. JSON export/import now includes the new analytics, inbox, push and video-concept tables; SQLite backups include the complete database.
- Mastery uses a 14-day half-life, L1–L5 weights of 0.6–1.4, and half credit for hinted correct attempts. Chapter mastery uses all chapter attempts. Daily concept snapshots run at server start and each new IST day; analytics requests also refresh the requested dates. Today suggests the weakest concept in the active plan week, then an attempted concept below 50%.
- Best next hours ranks chapters from `data/weightage.json` using subject marks, chapter accuracy and estimated remaining study hours. Practice has a ranking screen with Practise and Add to plan.
- Doubt buttons on questions, concepts and chapters; a Review entry opens the Doubts list with Markdown and KaTeX answers and a new answer badge. The profile menu opens Reports with an unread badge.
- Submitted mock and PYQ results show time per question, slowest questions, skip candidates, negative marks lost, labelled guess accuracy, section time split and a suggested order based on submitted test history.
- Reminder settings include the iPhone Home Screen guide, opt-in Web Push, morning/next-block/check-in/mistakes schedule, quiet hours and gym-time mute. The server sends encrypted `aes128gcm` Web Push with VAPID and deduplicates deliveries.
- Stats shows weekly/monthly hours by subject, question accuracy, mastery gain, study days, best/worst chapters, adherence, energy/sleep/time-of-day accuracy and mock score trends. Score targets are configurable. Missing `data/cutoffs.json` has an explicit empty state.
- Practice has 60/120-second NAT speed drills with the existing virtual calculator and server-graded personal bests. Learn has an A4 print revision sheet per subject.
- `seed/import_content.ts` imports `data/videos/<topic_id>.json` into `videos` and `video_concepts`, skipping filenames starting `_`; `data/videos/_sample.json` documents the supported shape. Concept and question Watch links use curated timestamps. Chapter videos show language and publication-year chips. Existing question video URLs remain the fallback.
- The scene validator now accepts an x-only or y-only move, matching the animation engine and allowing the existing `toc.langs_pumping.json` explainer to pass validation.

## New endpoints

`GET /api/digest`; `GET /api/mastery`; `GET /api/priority`; `GET /api/strategy/:id`; `GET /api/analytics/period`, `/energy`, `/scores`; `GET /api/drills/questions`, `POST /api/drills/results`; `GET`, `POST` `/api/doubts`, `PATCH /api/doubts/:id`; `GET`, `POST` `/api/reports`, `PATCH /api/reports/:id`; `GET /api/push/vapid`, `POST`, `DELETE` `/api/push/subscriptions`; `GET /api/videos/for-concept`, `/api/videos/for-question/:id`. Request and response shapes are in `server/API.md`.

## Verification

- `bun test`: 71 passed, 0 failed. Added tests cover mastery weighting, priority order, digest, doubt/report CRUD, endpoint responses and curated video import with timestamp lookup and repeat import.
- `bun run typecheck`: passed.
- `bun run build`: passed.
- No deployment, staging or commit was performed.

## Pending inputs and limits

- The requested `spec/09-design-system-v2.md` and `spec/10-learn-practice-test.md` were not present in this checkout. The implementation followed the current UI components and module conventions.
- The real `research/videos/<topic_id>.json` files and `../research/cutoffs.json` were inaccessible under the task override. No real curated videos or cutoff estimates were copied. Add the real files to `data/videos/` and `data/cutoffs.json` when available; rerun `bun run import-content` for videos. The `_sample.json` file is ignored by the importer.
- Web Push delivery was not tested against a live push service or iPhone because VAPID keys and a device subscription were unavailable. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and optionally `VAPID_SUBJECT` to enable it.
- The printable sheet is designed for one A4 page with capped sections; print layout may vary with unusually long formula text. The score tracker will show qualifying cutoff lines once a supported cutoff file is present.
