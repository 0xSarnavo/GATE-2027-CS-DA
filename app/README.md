# GATE CS + DA study app

A private, single-user study PWA for GATE CS, DA, or both. It combines a daily plan, practice questions, explainers, flashcards, mock tracking, and check-ins. The jobs tracker is optional. Bun and Hono serve the API and Preact app from one origin, with SQLite for user data and an offline-capable PWA.

## Run your own copy

1. Install [Bun](https://bun.sh/) and run `bun install` and `bun run build` in this directory.
2. Set `APP_PASSWORD_HASH` (`bun run hash-password 'your password'`), `API_TOKEN` and `SESSION_SECRET` (independent random secrets). Set `DATA_DIR` to a persistent, writable directory. The default local directory is `.data/`.
3. Run `bun start`, sign in, and complete the four-step setup. Choose CS, DA, or both; dates; study hours; optional routine blocks and breaks; and modules. The app creates a plan from topics in the content pack.
4. For Railway, follow [DEPLOY.md](DEPLOY.md). Mount a persistent volume before starting the service. Never put secrets in `app.config.json`.

For local development, run `bun run dev` for the API and `cd web && bun run dev` for Vite. Run `bun test`, `bun run typecheck`, and `bun run build` before changing a deployment.

## Modules and content

`app.config.json` is the deployment allowlist for `planner`, `practice`, `learn`, `review`, `mocks`, `habits`, and `jobs`. This repository includes the owner's configuration, with jobs enabled. For a fresh copy, remove `jobs` from that list if you do not want it available. `MODULES=planner,practice,learn,review,mocks,habits` overrides the file at startup. Settings and onboarding let you turn allowed modules on or off for this database. A disabled module has no usable API routes or screens; its data remains in SQLite so it can be enabled again.

`CONTENT_DIR` points to the data-only content pack, default `./data`. The pack uses the existing `questions/`, `tags/`, `ladders/`, `explainers/`, `external/`, and `img/` formats. The planner reads `CONTENT_DIR/topics.json` in file order; this repository currently keeps that catalog in `seed/topics.json`, which is used as a fallback. The content importer never replaces your plan, attempts, or check-ins.

The historical owner plan is `profiles/owner/plan.json`, with its routine and break data in `profiles/owner/routine.json`. To import it into a **new, empty** database, set `SEED_ON_BOOT=1` and `PROFILE=owner` on the first start. Leave `SEED_ON_BOOT` unset for onboarding. Never enable owner seeding for somebody else's fresh install. A populated database is never reseeded at boot.

## API and data

[server/API.md](server/API.md) documents the existing `/api/...` endpoints and the new setup/module endpoints. `GET /api/export` makes a JSON backup, and the app also keeps SQLite backups under `DATA_DIR/backups`. SQLite uses WAL mode. The database file and imported user data are never stored in the content pack.
