# Foundations implementation notes

- `seed/topics.json` defines the Foundations root and 14 child chapters. The eight calculus foundations appear as a path in Learn, followed by six other foundations. Existing databases receive missing topics on boot; seed rows and user edits are preserved.
- `data/prereqs.json` maps all 113 existing leaf chapters. The content importer inserts prerequisite edges into `topic_prereqs` with `INSERT OR IGNORE`, and `/api/topics/:id/prereqs` reports topic status, Got it counts, latest concept mastery, and readiness.
- `data/readiness/calc.limits.json` is the first authored check. The readiness endpoint reads new files as they arrive, hides answers on GET, grades MCQ and numeric answers on POST, reports gaps by prerequisite, and retains the latest result. The Learn UI links a gap to the first unfinished foundation concept when content exists.
- Foundation explainer and ladder files have not been authored yet. Their chapter pages show **Coming soon**; the existing importer and chapter renderer will use those files as normal when added. Readiness checks for other chapters also show **Coming soon** until their JSON files arrive.
- Owner plan seeding adds a 30 minute foundation block on each future plan day from 8 October through 15 November 2026: calculus track first, then fractions/percentages, vectors/matrices, and binary. Later weeks receive readiness tasks for their scheduled chapters at the start of the week. Stable IDs make the additions idempotent.
- SQLite's original `scope` CHECK only permits `shared`, `cs`, and `da`. Migration 0008 adds `scope_override` so Foundation rows have the effective API scope `foundation` while keeping the existing tables and their foreign keys intact.

Run `bun test server`, `bun run typecheck`, and `bun run build` to verify. No deployment or commit is part of this change.
