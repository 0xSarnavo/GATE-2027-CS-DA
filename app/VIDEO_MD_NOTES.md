# Video player and Markdown changes

## Changed

- Added an in-app YouTube privacy-enhanced player, loaded when Watch is used. It stays mounted across in-tab navigation, supports a mini-player and full-screen layout, seeks from concept markers, highlights the current concept, offers a local resume position, and shows “Videos need internet” offline. The optional Open in YouTube link carries the current time.
- Replaced external Watch links on concepts, questions, and chapter videos. The chapter catalog now groups best clips by concept, full lectures (at least 60% concept coverage, or unmapped and over 25 minutes), and more videos. Concept clips rank timestamped coverage before 2025–2027 recency and level. Subject Video course follows planned chapter order and has a server-backed watched tick.
- Added additive migration `0007_video_progress.sql`; JSON export/import and default sync snapshots include `video_progress`. Existing video API paths and response shapes remain available.
- Routed question options, hints, solutions, explainer and concept text, formula and trap sheets, flashcards, doubt notes and answers, reports, my notes previews, plan task titles, and changelog items through the shared Markdown and KaTeX renderer. Code blocks use monospace and horizontal scroll; tables scroll horizontally on narrow screens. Math waits for KaTeX without showing raw TeX.
- No Content Security Policy is set in this server, so no CSP or frame header change was needed.

## New endpoints

- `GET /api/videos/chapter?topic_id=`: concept picks, full lectures, and more videos, with jump points.
- `GET /api/videos/concept?topic_id=&atom_id=`: ranked clips for one concept.
- `GET /api/videos/course?subject_id=`: leaf chapters in planned order with their video groups.
- `GET /api/videos/progress`: all `{video_id,position_s,completed,updated_at}` rows.
- `PUT /api/videos/progress`: `{video_id,position_s,completed?}`; omitting `completed` retains the tick.

## Verification

- `bun test`: 72 passed, 0 failed. New checks cover video ranking, catalog/course responses, progress updates, and visible Markdown tokens in real ladder and explainer samples.
- `bun run typecheck`: passed.
- `bun run build`: passed.
- `git diff --check`: passed.

## Remaining

- A live YouTube playback and device layout check was unavailable in this workspace. The production build and API tests pass, but player interaction was verified from code, not a live embed.
- The existing `data/videos/` directory has 113 curated chapter packs (391 videos). Only four videos currently have concept mappings, so most clips show “timestamps pending.” The importer now maps pack levels `intro`, `gate`, and `advanced` to sortable values. `data/` was not edited.
