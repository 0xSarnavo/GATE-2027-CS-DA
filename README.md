# GATE 2027: CS + DA

Start with `01-START-HERE.md`. This folder contains the study schedule, syllabus comparison, video map, admissions shortlist, practice-paper index, and official PDFs.

Prepared 6 October 2026 for a CS graduate preparing for both papers while job hunting. Check the official GATE 2027 site for changes to dates and rules.

## Self-host the app with Docker

The `app/` directory is a single-user study app. Each person can run their own copy on a machine with Docker Engine and Docker Compose 2.30 or newer. The setup below builds the Bun server and web app, keeps the SQLite database in a Docker volume, and uses Caddy to serve it over HTTPS. Run these commands from this repository's root.

```sh
git clone https://github.com/0xSarnavo/GATE-2027-CS-DA.git
cd GATE-2027-CS-DA
cp .env.docker.example .env.docker
chmod 600 .env.docker
docker compose build app
docker compose run --rm app bun run hash-password
openssl rand -hex 32
openssl rand -hex 32
```

The password command prompts for your login password and prints an Argon2id hash. Edit `.env.docker`: replace `APP_PASSWORD_HASH` with that entire hash, and replace `API_TOKEN` and `SESSION_SECRET` with the two different random values. Keep the `$` characters in the hash and do not add quotes; Compose passes this file as raw values. The file is ignored by Git. Do not set `SEED_ON_BOOT` for a new user's copy: the first sign-in opens setup instead of importing the original owner's plan.

Edit `Caddyfile` and replace `study.example.com` with a domain you control. Point its DNS `A` record at the server's public IPv4 address. If you publish an `AAAA` record, it must point at a reachable IPv6 address. Open TCP ports 80 and 443 in the server firewall. On a home network, forward those ports from the router to the Docker host's LAN address; UDP 443 is optional for HTTP/3. The app's port 3000 is bound to localhost for checks and should not be forwarded. A connection behind carrier-grade NAT needs a publicly reachable VPS or a tunnel instead of router forwarding. Caddy obtains and renews the HTTPS certificate once the domain and ports are reachable.

```sh
docker compose up -d --build
curl -fsS http://127.0.0.1:3000/healthz
docker compose logs --tail=50 app caddy
```

Open `https://your-domain` from any device, sign in with the password, and finish the four-step setup. On a phone, use the browser's **Add to Home Screen** action to install the PWA. This is one shared account and one study database per deployment; it does not provide separate accounts for multiple people.

The `app_data` Docker volume holds the database and built-in backups. `docker compose down` keeps it; `docker compose down -v` deletes it. Export your data from the app before moving servers. To update the code while keeping the database and Caddy certificates, run `git pull` followed by `docker compose up -d --build`. See [app/README.md](app/README.md) for app features and [app/DEPLOY.md](app/DEPLOY.md) for the Railway alternative.

## Files

- `01-START-HERE.md` — deadlines and how to use the pack
- `02-STUDY-PLAN.md` — timetable and week-by-week plan
- `03-SYLLABUS-AND-OVERLAP.md` — both syllabi and year-wise changes
- `04-VIDEOS.md` — English/Hinglish lessons in 2–3-video chunks
- `05-PRACTICE-AND-BOOKS.md` — ten years of CS, all DA years, and book picks
- `06-ADMISSIONS.md` — DA-accepting IIT/IISc programmes
- `07-JOB-HUNT.md` — a small daily applications and referral routine
- `papers/` and `syllabi/` — official downloaded PDFs where available

Official home: https://gate2027.iitm.ac.in/
