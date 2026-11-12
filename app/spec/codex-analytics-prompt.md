Implement section A of spec/11-analytics-and-automation.md, items 1–11, in this GATE study PWA: Bun + Hono + bun:sqlite in `server/`, with modules in `server/modules/*`; Preact + Vite + TS in `web/`, with modules in `web/src/modules/*`. Read `spec/11`, `spec/09-design-system-v2.md`, `spec/10-learn-practice-test.md`, `spec/07-modular-and-ui.md`, `server/API.md` and `REFACTOR_NOTES.md` first. Follow the current UI system (black/white with orange, chunky components) and the existing module pattern. Each feature lives in the module it belongs to; reports and doubts go in a new `insights` module.

**Server endpoints:**
- `GET /api/digest?from=&to=`: one compact JSON of everything a coach needs for the period.
- `/api/reports`: GET, POST, plus PATCH to mark read.
- `/api/doubts`: GET, POST and PATCH.
- Mastery, priority and strategy analytics endpoints.
- Web Push subscription and a scheduler.

**Data files:** use the existing `data/weightage.json` (already computed from the tagged papers). For cutoffs, read `../research/cutoffs.json` if it exists and copy it to `data/cutoffs.json`. Otherwise ship the feature with an empty-state message.

**Constraints:**
- Additive migrations only.
- Keep every existing API path and response shape.
- Tests for mastery maths, priority ranking, the digest and the reports/doubts CRUD.
- `bun test` and `bun run build` must pass.
- Update `server/API.md`.
- Do not deploy.
- Commit with `git commit --no-gpg-sign`, with a message ending in a blank line then `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`. Stage only `server/`, `web/`, `data/weightage.json`, `data/cutoffs.json` and `spec/`.

**Videos (also in this task):**
- Curated, transcript-checked YouTube videos per chapter arrive as `research/videos/<topic_id>.json`. See `research/VIDEO_PROMPT.md` for the shape.
- Copy them into `data/videos/`. This is allowed.
- Extend `seed/import_content.ts` to load them into the existing videos table, with additive columns for channel, lang, published, duration_s, level and why, plus a `video_concepts` table (video_id, topic_id, atom_id, start_s, note).
- **UI:**
  - each concept card's "Watch" opens the best video at that concept's timestamp (`&t=<start_s>s`);
  - each chapter shows a "Videos" list with language and recency chips;
  - the question screen's "Watch" uses the timestamp of the question's first atom.
