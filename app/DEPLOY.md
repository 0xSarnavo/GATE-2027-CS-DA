# Deploying to Railway

One service (Bun + Hono + SQLite) serves the API and the built PWA. Data lives on a Railway volume. Nothing here has been deployed yet.

## What ships in the deploy bundle
`railway up` uploads the working directory minus whatever `.gitignore` excludes (`railway.json` runs `bun install && bun run build` on Railway, so `web/dist` is built there).

| Needed at runtime | Where it comes from |
|---|---|
| server, `seed/`, `profiles/owner/`, `app.config.json`, `data/questions`, `data/tags`, `data/ladders`, `data/explainers`, `data/external/*.json` | committed, shipped as-is |
| question images `data/img/*.webp` (about 28 MB) | committed, shipped as-is; the server serves `DATA_DIR/img` first, then the bundled `app/data/img` |
| `web/dist` | built by Railway |
| excluded by `.gitignore` | `.data/`, `node_modules`, `web/dist`, `tools/.venv`, `data/img-png-original/` (140 MB of original PNGs, local only), raw research under `data/external/*/` (PDFs, scrapes) |

Images need no upload step. To add one-off images later use `POST /api/media` (stored in `DATA_DIR/media`). The importer, not a person, switches `image_refs` from `.png` to `.webp`.

Regenerating images locally: `tools/.venv/bin/python tools/recrop_fixes.py` (targeted re-crops of the four broken whole-page strips plus 2019-CS-q31) then `tools/.venv/bin/python tools/optimize_images.py` (PNG to WebP q80; PNGs move to `data/img-png-original/`).

## Steps
1. Create the project and service from this directory (the git root is `app/`):
   ```sh
   cd app
   railway login
   railway init            # new project, e.g. gate27
   railway add --service gate27   # empty service (or let `railway up` create it)
   ```
2. Add a volume mounted at `/data`:
   ```sh
   railway volume add --mount-path /data
   ```
   The server refuses to boot on Railway without a volume (override only with `ALLOW_EPHEMERAL_DATA=1`). `RAILWAY_VOLUME_MOUNT_PATH` is picked up automatically; `DATA_DIR=/data` is the explicit equivalent.
3. Generate secrets and set variables:
   ```sh
   bun run hash-password 'your-password'     # prints an argon2id hash; keep the quotes below
   openssl rand -hex 32                      # use once for API_TOKEN, once for SESSION_SECRET
   railway variables \
     --set 'APP_PASSWORD_HASH=<hash from above, contains $ characters>' \
     --set API_TOKEN=<hex> --set SESSION_SECRET=<hex> \
     --set TZ=Asia/Kolkata --set DATA_DIR=/data
   ```
   - `APP_PASSWORD_HASH`: the app login password. Wrap it in single quotes in a shell or `.env` (the `$` characters).
   - `API_TOKEN`: the bearer token Claude agents use (`Authorization: Bearer ...`, see `server/API.md`).
   - `SESSION_SECRET`: hashes session ids. Production refuses to start if any of the three is missing.
   - For the historical owner profile only, set `SEED_ON_BOOT=1` and `PROFILE=owner` before the first boot. Otherwise the signed-in app opens onboarding on an empty database.
   - Optional: `BACKUP_KEEP=14`, `BACKUP_PUSH_URL` (PUT of the nightly `.db`), `IMPORT_ON_BOOT=0` to stop the importer running at boot.
4. Deploy: `railway up` (builds, starts `bun server/index.ts`, health check `/healthz`).
5. Generate a domain: `railway domain`. Open it, sign in, then on iPhone use Share, Add to Home Screen.

## How content reaches production
Boot always runs the content importer (idempotent): tags, pre-2017 questions, ladders, explainers, flashcards, external answer cross-checks, discussion links, WebP refs. So **new ladder, tag, explainer or external files go live with a normal `railway up`**. To re-run without a redeploy: `curl -X POST -H "Authorization: Bearer $API_TOKEN" https://<domain>/api/import/content` (reads the files already in the deploy bundle).

User data (attempts, mistakes, check-ins, card reviews, plan edits) lives only in the volume database and is never touched by the importer. The importer only rewrites question content fields it owns (tags, difficulty, ladder content, and official answers only when they were empty).

## Backups
- Nightly after 02:30 IST: `DATA_DIR/backups/gate-YYYYMMDD.db`, newest 14 kept. Manual: `POST /api/admin/backup`; download the newest: `GET /api/admin/backup/latest`.
- Full JSON export: `GET /api/export` (restorable via `POST /api/import` with `mode=replace_tables`), or Settings, Export.

## Local production dry run
```sh
export NODE_ENV=production DATA_DIR=$(mktemp -d) PORT=3098 \
  APP_PASSWORD_HASH='<hash>' API_TOKEN=devtoken SESSION_SECRET=devsecret
bun run build && bun server/index.ts      # identical to the Railway start command
curl localhost:3098/healthz
```
Secure cookies need https; browsers still accept them on `localhost`. Port 3000 may be taken by other projects, so pick another `PORT`.

## Checklist after the first deploy
- `GET /healthz` returns `{"ok":true}`.
- Sign in; complete onboarding on a new copy. Today then shows the plan, and Practice shows topics with ladders.
- `curl -H "Authorization: Bearer $API_TOKEN" https://<domain>/api/questions?limit=1` works.
- Restart the service and confirm data survived (volume mounted at `/data`).

## Sharing this app (new copy)

For a new user's copy, leave `SEED_ON_BOOT` unset. On first boot the server loads topics and question content but leaves the plan empty; the signed-in PWA shows onboarding. Set `CONTENT_DIR` to a compatible content pack if you keep one outside `./data` (`topics.json` is read from there, with `seed/topics.json` as this repository's fallback). Preserve `DATA_DIR` on a volume so the plan and study history survive restarts.

`app.config.json` lists available modules. `MODULES` can override it at startup (comma-separated ids). The owner config includes `jobs`; new users can leave it off during onboarding or remove it from the allowlist. Settings stores per-database switches. Disabled modules keep their data and can be enabled again. `profiles/owner/plan.json` is imported only when `SEED_ON_BOOT=1` and `PROFILE=owner` on an empty database. Existing production databases are never overwritten by this flow. The new `0004_modules.sql` migration adds indexes; it does not alter existing rows.

The Vite build stamps the service worker cache name with a hash of the emitted asset names. Deploy the built `web/dist` with the server; the app offers an update when a new worker is ready.
