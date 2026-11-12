# GATE 2027 Prep App: Architecture Spec

Status: design only. Single user, mobile-first installable PWA, one Railway service plus one volume.
Context: study pack in `../../*.md` (plan 02, syllabus 03, videos 04, practice 05, jobs 07; `practice-log.csv`, `job-search.csv`).

## 1. Goals and non-goals

Goals
- Daily driver on a phone: see today's tasks, practise questions, log the day, review cards. Works offline.
- Claude (an agent) reads everything and rewrites plan, questions, cards, explanations through a token-protected JSON API.
- The whole system is one process and one SQLite file. No queue, no Redis, no second service.

Non-goals: multi-user, accounts, social features, push notifications (v1), native apps, server-side rendering.

## 2. Stack and why

| Layer | Choice | Why | Rejected |
|---|---|---|---|
| Runtime | Bun | Already installed. Runs TS directly (no build for the server). Ships `bun:sqlite`, `Bun.password`, `Bun.serve`, so zero native deps. | Node 26: needs `better-sqlite3` (native build on Railway) or the newer experimental `node:sqlite`, plus `tsx`. |
| HTTP | Hono (only server dep) | 14 kB, typed routing, cookie and bearer middleware in a few lines, same code runs on Bun. | Plain `Bun.serve`: no dependency, but about 150 lines of hand-written routing, params, cookies and error handling. Express: heavier, no gain. |
| DB | `bun:sqlite` on a Railway volume, WAL mode | Single user, tiny data (thousands of rows). SQLite is a file, so backup is a copy and export is a query. Questions, cards and attempts are relational, so a real SQL engine pays off (streak and stats queries). | Postgres on Railway: second service, connection management, more cost, no benefit at this size. JSON files: no transactions, painful queries. |
| Frontend | Preact + Vite + TypeScript, hand-rolled hash router | About 4 kB runtime, React-like so the agent and user can extend it easily, Vite gives a static `dist/` that Hono serves. Hash routing means no server fallback rules. | SvelteKit-static: good DX, but adapter and routing conventions add moving parts, and a bigger toolchain for about 8 screens. Vanilla JS: fine at first, but forms, lists and the quiz state machines become unmaintainable. |
| Offline | Hand-written service worker (about 80 lines) plus IndexedDB via `idb-keyval` (about 600 B) | Full control over cache and sync. Two small, well-understood pieces. | `vite-plugin-pwa` / Workbox: large generated surface, harder to debug stale-cache problems. |
| Styling | One plain CSS file, CSS variables, system fonts, `prefers-color-scheme` | No build step needed for CSS, no framework. | Tailwind: build and config for little gain. |
| Validation | Hand-written type guards, or `valibot` (1 kB) if rules get repetitive | Keep deps tiny. | zod: larger, unneeded. |
| Tests | `bun test` (built in) for scheduler, SM-2 and API | No extra tooling. | Vitest: another dep. |

Total runtime deps: `hono`, `preact`, `idb-keyval`. Dev deps: `vite`, `@preact/preset-vite`, `typescript`.

Why one service: the API, static UI and DB share one origin, so session cookies, the service worker scope and CORS are all trivial (there is no CORS). One Railway service and one volume is the cheapest, least breakable deployment.

## 3. Architecture

```
Phone (PWA)                              Railway service (Bun)             Volume /data
+-----------------------+   HTTPS      +--------------------------+     +-------------+
| Preact UI             |<------------>| Hono                      |<--->| gate.db     |
| Service worker        |  cookie      |  /            static dist |     | gate.db-wal |
| IndexedDB: snapshot + |  session     |  /api/*       JSON        |     | backups/    |
|   outbox (queued writes)|            |  cron: nightly backup     |     | media/      |
+-----------------------+              +--------------------------+     +-------------+
Claude agent --- Bearer token ---------> /api/*  (same routes)
```

Auth
- UI: `POST /api/auth/login {password}` compares against `APP_PASSWORD_HASH` (Argon2 via `Bun.password.verify`). Sets cookie `sid`: random 32 bytes, HttpOnly, Secure, SameSite=Lax, 30 days. Sessions in table `sessions` (hash of sid stored, not raw). Login rate limit: 5 attempts per 15 minutes per IP, in memory.
- API: `Authorization: Bearer <API_TOKEN>`. Token compared in constant time. Bearer requests skip CSRF checks. Cookie requests with a non-GET method must carry header `X-Requested-With: app` (cheap CSRF defence on top of SameSite).
- Everything except `/api/auth/login`, `/healthz` and the static shell requires either credential.

Offline model
- Server is the source of truth. The client keeps a snapshot in IndexedDB: topics, questions (without attempts), flashcards, current plan window (today plus 14 days), videos, settings.
- `GET /api/sync/pull?since=<iso>` returns rows changed since that time (every syncable table has `updated_at` and `deleted_at`). The client pulls on launch, on `online`, and every 5 minutes while open.
- Writes (attempt, task status, check-in, card review, mistake review) go to an IndexedDB outbox and apply to the local snapshot optimistically. `POST /api/sync/push` accepts `[{id, op, table, data, client_ts}]`. Ops are idempotent: client-generated UUIDv7 ids, upsert semantics, so replays are safe. Flush on `online`, on launch, and via Background Sync where supported.
- Conflict rule: last write wins per row by `client_ts`, except `plan_tasks.status` where `done` beats everything. Claude edits to plan or content are server-side and arrive through `pull`, so conflicts are rare.
- Service worker: precache the app shell (hashed Vite assets, `index.html`, manifest, icons). Strategy for `/api/*` GETs is network-first with fallback to the IndexedDB snapshot (handled in app code, not the SW). Question images under `/media/*` are cache-first (immutable filenames), pre-fetched for the whole bank after first sync.
- Update flow: new SW installs silently. The UI shows a "New version, tap to reload" toast, never auto-reloads mid-quiz.

## 4. Repo layout

```
app/
  spec/                      # this folder
  server/
    index.ts                 # Hono app, static serving, startup (migrate, backup timer)
    auth.ts                  # login, session, bearer middleware
    db.ts                    # open db, PRAGMAs, migrate()
    migrations/0001_init.sql # DDL from section 5; later 000N files, applied in order
    routes/                  # plan.ts checkins.ts topics.ts questions.ts attempts.ts
                             # cards.ts mocks.ts jobs.ts videos.ts stats.ts sync.ts admin.ts
    lib/scheduler.ts         # adaptive rescheduling (section 6)
    lib/sm2.ts               # card scheduling
    lib/streaks.ts           # streak queries
    lib/backup.ts            # VACUUM INTO nightly
    test/*.test.ts
  web/
    index.html  vite.config.ts
    public/manifest.webmanifest  icons/  sw.js
    src/main.tsx router.ts api.ts (fetch + outbox) store.ts (IndexedDB)
    src/screens/{Today,Plan,Practice,Cards,Log,Stats,Settings}.tsx
    src/games/{MatchPairs,TimedRecall}.tsx
  seed/                      # one-off import scripts: syllabus -> topics, 04-VIDEOS.md -> videos,
                             # downloads.tsv -> question stubs, plan seed from 02-STUDY-PLAN.md
  package.json  bun.lock  Dockerfile (optional)  railway.json  .env.example
```

Build: `bun run build` runs `vite build web` into `web/dist`. Start: `bun server/index.ts`. Server serves `web/dist` with `serveStatic`, and `index.html` with `Cache-Control: no-cache`, hashed assets `immutable`.

## 5. Data schema (SQLite DDL)

Conventions: ids are TEXT (UUIDv7, client or server generated) except small lookup tables. Timestamps are ISO-8601 UTC TEXT. Dates are `YYYY-MM-DD` in IST (`settings.tz = Asia/Kolkata`). Every syncable table carries `updated_at` and `deleted_at` (soft delete). Booleans are INTEGER 0/1. Pragmas: `journal_mode=WAL; foreign_keys=ON; synchronous=NORMAL; busy_timeout=5000`.

```sql
-- ===== settings & auth =====
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
-- seeded keys: exam_date=2027-02-06, gym_start=17:00, gym_end=19:00, tz=Asia/Kolkata,
--   default_study_minutes=390, weekday_study_minutes=390, weekend_study_minutes=300,
--   sleep_target_h=7, job_block=08:00-10:00
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, created_at TEXT, expires_at TEXT);

-- ===== topics (syllabus tree) =====
CREATE TABLE subjects (          -- Engineering Maths, DSA, Algorithms, DBMS, OS, ... Probability, ML, AI
  id TEXT PRIMARY KEY, name TEXT NOT NULL, scope TEXT NOT NULL CHECK (scope IN ('shared','cs','da')),
  sort INTEGER DEFAULT 0
);
CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  parent_id TEXT REFERENCES topics(id),
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('shared','cs','da')),   -- from 03-SYLLABUS-AND-OVERLAP.md
  sort INTEGER DEFAULT 0,
  est_minutes INTEGER,                       -- rough first-pass study time
  notes TEXT,
  updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX topics_subject ON topics(subject_id, parent_id, sort);
CREATE TABLE topic_progress (
  topic_id TEXT PRIMARY KEY REFERENCES topics(id),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','learning','practising','revised','mastered')),
  confidence INTEGER CHECK (confidence BETWEEN 1 AND 5),     -- self rating
  questions_done INTEGER DEFAULT 0, questions_correct INTEGER DEFAULT 0,  -- denormalised cache, rebuilt from attempts
  last_studied_on TEXT, updated_at TEXT NOT NULL
);

-- ===== plan =====
CREATE TABLE phases (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,         -- 'habit', 'full'
  start_date TEXT NOT NULL, end_date TEXT NOT NULL, description TEXT, updated_at TEXT NOT NULL
);  -- seed: habit 2026-10-07..2026-10-25 ; full 2026-10-26..2027-02-06
CREATE TABLE weeks (
  id TEXT PRIMARY KEY, phase_id TEXT NOT NULL REFERENCES phases(id),
  week_no INTEGER NOT NULL, start_date TEXT NOT NULL UNIQUE,   -- Monday (or 26 Oct start)
  end_date TEXT NOT NULL,
  title TEXT,                                  -- 'Probability, Bayes; C refresh'
  macro_goals TEXT NOT NULL DEFAULT '[]',      -- JSON: [{id,text,done}]
  review_notes TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE plan_days (
  date TEXT PRIMARY KEY, week_id TEXT NOT NULL REFERENCES weeks(id),
  available_minutes INTEGER,                   -- NULL = use default for weekday/weekend
  day_kind TEXT NOT NULL DEFAULT 'normal' CHECK (day_kind IN ('normal','light','off','mock','travel')),
  note TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE plan_tasks (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL REFERENCES plan_days(date),
  sort INTEGER DEFAULT 0,
  title TEXT NOT NULL,
  subject_id TEXT REFERENCES subjects(id),
  topic_id TEXT REFERENCES topics(id),
  type TEXT NOT NULL CHECK (type IN ('study','pyq','revision','mock','GA','job','gym')),
  est_minutes INTEGER NOT NULL DEFAULT 30,
  min_minutes INTEGER,                         -- smallest useful version when scaling down (NULL = unscalable)
  priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),  -- 1 = must, 3 = nice
  fixed INTEGER NOT NULL DEFAULT 0,            -- 1 = never moved/scaled (gym, job block)
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done','skipped','moved')),
  done_minutes INTEGER DEFAULT 0,              -- partial progress
  carried_over_from TEXT REFERENCES plan_tasks(id),   -- original task if this is a carry
  carry_count INTEGER DEFAULT 0,
  origin_date TEXT,                            -- date first planned
  completed_at TEXT, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX tasks_date ON plan_tasks(date, sort);
CREATE INDEX tasks_status ON plan_tasks(status, date);
CREATE TABLE plan_revisions (                  -- audit trail of every rewrite (by user or Claude)
  id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL,   -- 'user'|'claude'|'scheduler'
  reason TEXT, diff TEXT NOT NULL                                -- JSON {added:[],changed:[],removed:[]}
);

-- ===== daily check-in & habits =====
CREATE TABLE checkins (
  date TEXT PRIMARY KEY,
  gym_done INTEGER DEFAULT 0, gym_minutes INTEGER,
  sleep_hours REAL, mood INTEGER CHECK (mood BETWEEN 1 AND 5), energy INTEGER CHECK (energy BETWEEN 1 AND 5),
  job_applications INTEGER DEFAULT 0, referrals_sent INTEGER DEFAULT 0,
  revision_done INTEGER DEFAULT 0,             -- ticked, or derived from cards/mistakes reviewed
  notes TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE study_minutes (                   -- per subject per day; sums feed stats
  date TEXT NOT NULL, subject_id TEXT NOT NULL REFERENCES subjects(id),
  minutes INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'manual',  -- 'manual'|'task'|'attempts'
  updated_at TEXT NOT NULL, PRIMARY KEY (date, subject_id, source)
);
-- Streaks are DERIVED (no table). habit rules, evaluated per date in IST:
--   study    : SUM(study_minutes) >= settings.streak_study_min (default 60)
--   gym      : checkins.gym_done = 1
--   revision : revision_done = 1 OR (card reviews + mistake reviews that day >= 5)
--   job      : job_applications >= 1 (weekdays only; weekends are skipped, not breaks)
-- current streak = consecutive qualifying days ending today (or yesterday if today is not yet done).
-- Longest streak and a 1-day "freeze" per 7 days are computed in lib/streaks.ts.

-- ===== question bank =====
CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('official','generated','book','custom')),
  paper TEXT CHECK (paper IN ('CS','DA','GA')),          -- official only
  year INTEGER, session TEXT, q_no TEXT,                  -- e.g. 2024, 'S1', '17'
  topic_id TEXT NOT NULL REFERENCES topics(id),           -- primary topic; extra via question_topics
  type TEXT NOT NULL CHECK (type IN ('MCQ','MSQ','NAT')),
  marks INTEGER NOT NULL DEFAULT 1 CHECK (marks IN (1,2)),
  stem TEXT NOT NULL,                                     -- Markdown + KaTeX ($...$)
  options TEXT,                                           -- JSON [{key:'A',text}] (MCQ/MSQ)
  answer TEXT NOT NULL,                                   -- 'B' | 'A,C' | '12.5' | NAT range '12.4..12.6'
  difficulty INTEGER NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
  order_in_topic INTEGER,                                 -- easy -> hard ordering for generated sets
  quick_method TEXT,                                      -- Markdown: "quick way" steps
  solution TEXT,                                          -- Markdown: full worked solution
  explanation TEXT,                                       -- concept explanation
  trap_note TEXT,                                         -- tricky-trap / "where people slip"
  video_url TEXT, video_start_s INTEGER,
  image_refs TEXT DEFAULT '[]',                           -- JSON ["media/2023-cs-q14-fig1.png"]
  pdf_ref TEXT,                                           -- path/page in papers/ for provenance
  needs_review INTEGER DEFAULT 0,                         -- flag for answer/solution to verify
  created_by TEXT DEFAULT 'user',                         -- 'user'|'claude'|'import'
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE UNIQUE INDEX q_official ON questions(paper, year, session, q_no) WHERE source='official' AND deleted_at IS NULL;
CREATE INDEX q_topic ON questions(topic_id, difficulty, order_in_topic);
CREATE TABLE question_topics (question_id TEXT REFERENCES questions(id), topic_id TEXT REFERENCES topics(id),
  PRIMARY KEY (question_id, topic_id));       -- secondary topic tags

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id),
  at TEXT NOT NULL,
  given_answer TEXT, correct INTEGER NOT NULL,             -- 0/1 (NAT with range; MSQ all-or-nothing)
  time_s INTEGER,
  error_type TEXT CHECK (error_type IN ('concept','calculation','reading','time','guess')),
  used_hint INTEGER DEFAULT 0, mode TEXT DEFAULT 'practice',  -- 'practice'|'mock'|'revision'
  mock_id TEXT REFERENCES mocks(id), notes TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX att_q ON attempts(question_id, at);
CREATE INDEX att_day ON attempts(at);

CREATE TABLE mistakes (                         -- one open row per question until retired
  id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES questions(id),
  attempt_id TEXT REFERENCES attempts(id),      -- the attempt that created it
  error_type TEXT, takeaway TEXT,               -- one-line "what I'll do differently"
  stage INTEGER NOT NULL DEFAULT 0,             -- 0 -> due +1d, 1 -> +7d, 2 -> +21d, 3 = retired
  due_on TEXT NOT NULL, last_reviewed_on TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','retired')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX mistakes_due ON mistakes(status, due_on);
-- Review rule: correct -> stage+1, due_on = today + [1,7,21][stage]; stage 3 -> retired.
--              wrong   -> stage = 0, due_on = tomorrow.

-- ===== flashcards =====
CREATE TABLE cards (
  id TEXT PRIMARY KEY, topic_id TEXT REFERENCES topics(id),
  kind TEXT NOT NULL DEFAULT 'qa' CHECK (kind IN ('qa','pair','cloze')),
  front TEXT NOT NULL, back TEXT NOT NULL,                -- pair: front = name, back = formula
  hint TEXT, tags TEXT DEFAULT '[]', game_ok INTEGER DEFAULT 1,  -- usable in memory games (short text only)
  -- SM-2 state
  ease REAL NOT NULL DEFAULT 2.5, interval_d INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0, lapses INTEGER NOT NULL DEFAULT 0,
  due_on TEXT NOT NULL, last_reviewed_on TEXT,
  created_by TEXT DEFAULT 'user', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX cards_due ON cards(due_on) WHERE deleted_at IS NULL;
CREATE TABLE card_reviews (
  id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id), at TEXT NOT NULL,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 0 AND 5), time_ms INTEGER,
  mode TEXT DEFAULT 'review',                  -- 'review'|'match'|'recall'
  updated_at TEXT NOT NULL
);
CREATE TABLE game_scores (
  id TEXT PRIMARY KEY, game TEXT NOT NULL, at TEXT NOT NULL, topic_id TEXT,
  score INTEGER, duration_s INTEGER, detail TEXT, updated_at TEXT NOT NULL
);

-- ===== mocks (replaces practice-log.csv) =====
CREATE TABLE mocks (
  id TEXT PRIMARY KEY, date TEXT NOT NULL,
  paper TEXT NOT NULL CHECK (paper IN ('CS','DA','GA','sectional')),
  year INTEGER, session TEXT, label TEXT,       -- 'CS 2024 S1', 'Made Easy sectional OS'
  raw_score REAL, max_score REAL DEFAULT 100, attempted_marks REAL, accuracy_percent REAL,
  duration_min INTEGER, unfinished INTEGER, time_issue TEXT,
  topics_to_revise TEXT DEFAULT '[]',           -- JSON up to three topic ids/names
  notes TEXT, updated_at TEXT NOT NULL, deleted_at TEXT
);

-- ===== job search (replaces job-search.csv) =====
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, company TEXT NOT NULL, role TEXT, url TEXT,
  date_applied TEXT, person_contacted TEXT, response TEXT,   -- 'none'|'ack'|'screen'|'interview'|'offer'|'rejected'
  next_follow_up TEXT, notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);

-- ===== videos =====
CREATE TABLE videos (
  id TEXT PRIMARY KEY, topic_id TEXT REFERENCES topics(id), subject_id TEXT REFERENCES subjects(id),
  title TEXT, url TEXT NOT NULL, source TEXT,             -- 'GateSmashers','StatQuest','3B1B'
  role TEXT DEFAULT 'concept' CHECK (role IN ('concept','worked-example','intuition')),
  language TEXT DEFAULT 'en', watched INTEGER DEFAULT 0, sort INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL, deleted_at TEXT
);

-- ===== misc =====
CREATE TABLE api_log (id INTEGER PRIMARY KEY, at TEXT, actor TEXT, method TEXT, path TEXT, status INTEGER);  -- last 5000 kept
CREATE TABLE import_runs (id TEXT PRIMARY KEY, at TEXT, actor TEXT, counts TEXT, errors TEXT);
```

## 6. Adaptive rescheduling algorithm (`lib/scheduler.ts`)

Pure function: `reschedule(state, trigger) -> {changes, revision}`. The server applies the changes in one transaction and writes a `plan_revisions` row. The same function runs in `dry_run` mode so the UI and Claude can preview.

Inputs
- Week W (days Mon..Sun, or whatever days remain in the week), tasks, `available_minutes` per day. If NULL, use the weekday or weekend default from settings. Fixed tasks (`fixed=1`, such as gym and job block) are never moved or counted against study capacity.
- Capacity of day d: `cap(d) = available_minutes(d)` for study-type tasks (study, pyq, revision, mock, GA). `day_kind='off'` gives 0, `light` gives 50%.

Trigger A: missed day (runs at the first app open or API call after midnight, and on demand via `POST /api/plan/reschedule {trigger:"missed"}`)
1. For each past day in the current week with tasks still `todo` or `doing`, collect the leftovers. A partly done task keeps `remaining = est - done_minutes`.
2. Mark each leftover `moved` on its original day (history kept). Each carry creates a new task on the target day with `carried_over_from = original.id`, `carry_count + 1`, `origin_date` preserved.
3. Candidate days are today through the end of the week. Sort leftovers by priority (1 first), then by `carry_count` descending (oldest debt first), then by original order.
4. Place greedily: for each leftover, choose the candidate day with the most free capacity (`cap - planned`) that is not a mock-day, and where the task fits. Remaining free capacity includes only slack. If no day fits, the task may be split into two parts (split only `study` and `pyq` tasks, minimum chunk 30 min).
5. No doubling rule: a day may absorb carry-overs only up to `cap(d) * 1.0`, never beyond its own capacity, and never more than 40% of its capacity from carry-overs, so the new day's planned work is not displaced. Anything left over after step 4 is not forced in.
6. Overflow: tasks that do not fit anywhere in the week go to a "Carry to next week" list (`date` = first day of next week, flagged with `carry_count`). The week's `review_notes` gets a line "N tasks (X min) pushed to next week". Priority-3 tasks that have carried twice are marked `skipped` and surfaced in the weekly review instead of carried forever.
7. Weekend slack: Sunday's weak-topic repair block is the preferred landing spot for overflow, per `02-STUDY-PLAN.md`.

Trigger B: "available study hours today" (`POST /api/plan/day/{date}/capacity {minutes}`)
1. Set `plan_days.available_minutes = minutes`. Let `planned` be the sum of non-fixed, non-done study-type tasks and `target` the capacity left, `minutes - done_minutes_today`.
2. If `planned > target` (scale down): compute `ratio = target/planned`. First drop or move priority-3 tasks to later days (via Trigger A placement). If still over, shrink the remaining tasks down to their `min_minutes` (never below), in priority order 3 then 2. If still over, move whole priority-2 tasks, last in order first. Priority-1 tasks are only touched if the user sets capacity under the sum of all priority-1 minutes, and then the UI warns.
3. If `planned < target` (scale up): pull forward the next priority-1/2 tasks from later days in the same week (earliest day first, not mocks) until the slack is under 15 minutes. Tasks can also be extended: PYQ and revision tasks may grow up to 1.5x est. Pulled tasks keep `origin_date`.
4. Round every adjusted `est_minutes` to the nearest 5.

Trigger C: manual or Claude rewrite. Uses plain CRUD (section 7) and the audit row, no scheduler. After any bulk change, `POST /api/plan/reschedule {trigger:"rebalance"}` re-validates the no-doubling invariant: for every day, planned study minutes <= `cap * 1.15`, otherwise overflow moves following steps 3 to 6.

Invariants (tested in `bun test`): fixed tasks never move; done tasks never move; no day exceeds 115% cap after a reschedule; reschedule is idempotent (second run gives zero changes); every move writes a `plan_revisions` entry.

## 7. HTTP API

Base `/api`. JSON in and out. Errors: `{"error":{"code":"validation","message":"...","details":{}}}` with 400/401/404/409/422. Ids are strings. List endpoints accept `limit` (default 100, max 1000) and `cursor`, and return `{items:[...], next:"..."|null}`. All writes accept `Idempotency-Key` (optional). Dates `YYYY-MM-DD`. `PATCH` merges fields, `PUT` replaces.

### 7.1 Auth and meta
| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/login` | `{password}` | 204 + cookie, or 401 |
| POST | `/auth/logout` | | 204 |
| GET | `/healthz` | | `{ok:true,db:true,version}` (no auth) |
| GET | `/me` | | `{actor:"user"|"claude", server_time, today}` |
| GET | `/settings` / PATCH | `{key:value,...}` | settings object |

### 7.2 Plan (Claude's main write surface)
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/plan` | query `from,to` (default today..+14d) | `{phases, weeks, days:[{date,available_minutes,day_kind,tasks:[...]}]}` |
| GET | `/plan/today` | | day plus tasks plus `due:{cards,mistakes}` counts plus `streaks` |
| GET/PATCH | `/plan/weeks/{week_id}` | `{title?, macro_goals?:[{id,text,done}], review_notes?}` | week |
| PUT | `/plan/weeks` | bulk replace of macro goals: `{weeks:[{start_date, title, macro_goals}]}` | `{updated}` |
| GET/PATCH | `/plan/days/{date}` | `{available_minutes?, day_kind?, note?}` | day (PATCH of `available_minutes` triggers Trigger B unless `?reschedule=false`) |
| POST | `/plan/tasks` | `{date,title,type,subject_id?,topic_id?,est_minutes,min_minutes?,priority?,fixed?}` or `{tasks:[...]}` | created task(s) |
| PATCH | `/plan/tasks/{id}` | any task field incl. `date`, `status`, `done_minutes` | task |
| DELETE | `/plan/tasks/{id}` | | 204 (soft delete) |
| POST | `/plan/tasks/{id}/complete` | `{done_minutes?}` | task; also upserts `study_minutes` for the task's subject (`source='task'`) |
| POST | `/plan/reschedule` | `{trigger:"missed"|"rebalance", week_start?, dry_run?:bool}` | `{changes:[{task_id,from,to,est_minutes,reason}], overflow:[...], revision_id}` |
| POST | `/plan/days/{date}/capacity` | `{minutes}` | same as reschedule response |
| POST | `/plan/replace` | `{from,to,tasks:[...],weeks?:[...],reason}`: atomically replaces all non-done tasks in range | `{revision_id,counts}` |
| GET | `/plan/revisions` | `?limit` | audit trail |

### 7.3 Check-ins, habits, notes
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/checkins` | `?from&to` | items |
| PUT | `/checkins/{date}` | `{gym_done,gym_minutes?,sleep_hours,mood,energy,job_applications,referrals_sent?,revision_done,notes,study_minutes:{subject_id:minutes}}` | checkin plus resulting streaks |
| GET | `/streaks` | | `{study:{current,longest,today_done},gym:{...},revision:{...},job:{...}}` |
| GET | `/log` | `?from&to` | joined daily view for Claude: checkin, study minutes, tasks done and missed, attempts summary, cards reviewed |

### 7.4 Topics and videos
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/topics` | `?scope=shared|cs|da&subject` | flat list plus `children` ids plus progress (client builds tree) |
| POST / PATCH / DELETE | `/topics[/{id}]` | topic fields | topic |
| PUT | `/topics/{id}/progress` | `{status?,confidence?,last_studied_on?}` | progress |
| GET | `/videos` | `?topic_id` | items |
| POST / PATCH / DELETE | `/videos[/{id}]` | video fields (POST also takes `{videos:[...]}`) | video(s) |

### 7.5 Questions, attempts, mistakes
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/questions` | `?topic_id&source&paper&year&difficulty_min&difficulty_max&type&q=text&needs_review&order=difficulty` | items (full fields) |
| GET | `/questions/{id}` | | question plus `{stats:{attempts,correct,avg_time_s}, last_attempts:[...]}` |
| POST | `/questions` | question fields, or `{questions:[...]}` (max 200) | created ids; unique official keys upsert |
| PATCH | `/questions/{id}` | any field (explanation, quick_method, video_url, trap_note, answer, ...) | question |
| DELETE | `/questions/{id}` | | 204 |
| POST | `/media` | multipart file, returns `{path:"media/<sha8>.png"}` (stored on volume, immutable) | |
| GET | `/media/{name}` | | image |
| POST | `/attempts` | `{id?,question_id,given_answer,time_s,error_type?,mode?,at?}` | `{attempt, correct, mistake?}` (server grades; wrong answer creates or resets mistake row) |
| GET | `/attempts` | `?from&to&question_id&topic_id&correct&error_type` | items |
| GET | `/mistakes` | `?due=today|all&status` | items with embedded question |
| POST | `/mistakes/{id}/review` | `{correct:bool}` | updated mistake (stage and due_on per rule) |
| PATCH | `/mistakes/{id}` | `{takeaway?,error_type?,status?}` | mistake |

Grading: MCQ exact key match. MSQ exact set match, no partial marks. NAT: `answer` is a number or `lo..hi` range, with tolerance applied.

### 7.6 Cards and games
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/cards` | `?topic_id&due=today&kind&limit` | items |
| POST / PATCH / DELETE | `/cards[/{id}]` | card fields (POST also takes `{cards:[...]}`) | card(s) |
| GET | `/cards/due` | `?limit=30&topic_id` | due cards (new cards capped to 10 per day) |
| POST | `/cards/{id}/review` | `{grade 0-5, time_ms?, mode?}` | updated SM-2 state |
| GET | `/games/pairs` | `?topic_id&n=6` | `{round:[{card_id,left,right}...]}` from `kind='pair'` or short `qa` cards |
| POST | `/games/scores` | `{game,topic_id?,score,duration_s,detail}` | score |

SM-2 (`lib/sm2.ts`): `grade < 3` gives `reps=0, interval=1, lapses++`. Else `reps 0 -> 1d, 1 -> 6d, n -> round(interval * ease)`. `ease = max(1.3, ease + 0.1 - (5-g)*(0.08 + (5-g)*0.02))`. UI buttons map to Again 0, Hard 3, Good 4, Easy 5. Match-pairs and timed recall write a `card_reviews` row with `mode` set and feed the same scheduler: a correct pair counts as grade 4, a wrong one as grade 1, timed recall maps response time to 3, 4 or 5.

### 7.7 Mocks, jobs, stats
| Method | Path | Body | Response |
|---|---|---|---|
| GET / POST | `/mocks` | mock fields | items / mock |
| PATCH / DELETE | `/mocks/{id}` | | mock |
| GET / POST | `/jobs` | job fields (POST also `{jobs:[...]}`) | items |
| PATCH / DELETE | `/jobs/{id}` | | job |
| GET | `/stats/overview` | `?from&to` | `{study_minutes_by_subject, by_day, accuracy_by_topic, accuracy_by_difficulty, avg_time_by_type, error_type_counts, mock_trend:{CS:[...],DA:[...]}, plan_adherence:{planned_min,done_min,by_week}, weak_topics:[{topic_id,score}], days_to_exam, syllabus_coverage:{cs,da}}` |

### 7.8 Sync, bulk, export (admin)
| Method | Path | Body | Response |
|---|---|---|---|
| GET | `/sync/pull` | `?since=<iso>` | `{server_time, tables:{questions:[...],cards:[...],plan_tasks:[...],...}}` (rows incl. deleted markers) |
| POST | `/sync/push` | `{ops:[{id,table,op:"upsert"|"delete",data,client_ts}]}` | `{applied:[ids],rejected:[{id,reason}],server_time}` |
| POST | `/import` | `{mode:"merge"|"replace_tables", dry_run?:bool, data:{subjects?,topics?,videos?,questions?,cards?,plan?:{phases,weeks,days,tasks},mocks?,jobs?,checkins?}}` | `{counts:{created,updated,skipped}, errors:[{table,index,message}]}`. Single transaction: all rows or none. Upsert by id, else by natural key (official question key, topic `subject+name`, video url, card `front+topic`). Also accepts `Content-Type: text/csv` with `?table=jobs|mocks` for the legacy CSVs. |
| GET | `/export` | | One JSON document: `{exported_at, schema_version, settings, subjects, topics, topic_progress, phases, weeks, plan_days, plan_tasks, plan_revisions, checkins, study_minutes, questions, question_topics, attempts, mistakes, cards, card_reviews, game_scores, mocks, jobs, videos}`. Output is accepted unchanged by `/import?mode=replace_tables`, so export then import is a full restore. Media is listed under `media:[{path,sha}]` and downloadable via `/media/*`. |
| POST | `/admin/backup` | | creates `/data/backups/gate-YYYYMMDD-HHMM.db` via `VACUUM INTO`, returns `{path,bytes}` |
| GET | `/admin/backup/latest` | | streams the newest `.db` file |

Claude cheat-sheet (also served as `GET /api/README.md`, so an agent can bootstrap itself): read `/log?from=..&to=..`, `/mistakes`, `/attempts`, `/stats/overview`; adjust `/plan/replace`, `/plan/tasks`, `/plan/weeks`; add content via `/questions`, `/cards`, `/videos`; add `created_by:"claude"` automatically for bearer requests so the UI can badge Claude-authored items.

## 8. Screens (mobile, bottom tab bar)

Bottom tab bar, 5 slots: **Today**, **Plan**, **Practice**, **Cards**, **Log**. Stats and Settings sit behind a top-right overflow menu on every screen (Stats via a chart icon, Settings via a gear). 48 px tap targets, safe-area insets, thumb-reachable primary actions at the bottom. Offline badge in the header when the outbox is non-empty ("3 changes queued").

- **Today**: date, days-to-exam, today's available hours (tap to change: triggers capacity rescale, with a preview sheet showing what moved). Task list grouped by time block (study, PYQ, revision, GA, job, gym) with check boxes, estimated minutes, and a tap-to-start timer that fills `done_minutes`. "Due now" strip: cards due, mistakes due, linked straight to review. Streak chips (study, gym, revision, job). "Missed yesterday: 3 tasks moved" banner with undo (uses revision diff). Check-in shortcut at the bottom.
- **Plan**: week view as a scrollable day strip, each day showing minutes planned vs capacity as a bar. Header shows the week's macro goals as checkable items. Tap a day to edit, add, move or skip tasks. Month and phase overview shows the two phases and week titles with a progress ring each. "Reschedule week" button with dry-run preview.
- **Practice**: topic tree (filter chips: All, Shared, CS, DA; progress dot per topic). Topic page: video links, confidence slider, mode toggle (Official PYQs | Generated | Mistakes), question list ordered easy to hard with a done/correct marker. Question view: stem (KaTeX, figures), answer input per type (radio, checkboxes, number pad), timer, Submit. Then reveal: correct or wrong, error-type chips if wrong (concept, calculation, reading, time, guess), "Quick method", full solution, concept explanation, trap note, video button. "Add to mistakes" is automatic on a wrong answer. Next question, skip, flag as needs-review.
- **Cards/Games**: today's due count and a Review button (flip card, four grade buttons with next-interval labels). Games: Match pairs (6 pairs, tap-to-match formula to name, timer, per-topic), Timed recall (card front shown, 10 s to think, reveal, self-grade; streak of correct answers), plus a mistakes-review mode (the 1d, 1w, 3w queue). Deck browser by topic and a quick-add card form.
- **Log/Check-in**: today's form: study minutes per subject (auto-filled from completed tasks and attempts, editable), gym toggle, sleep slider, mood and energy 1 to 5, job applications counter, notes. Segmented sub-tabs: Check-in, Mocks (log and trend; replaces `practice-log.csv`), Jobs (list, add, follow-ups due; replaces `job-search.csv`), History (past days with notes).
- **Stats**: study minutes by subject (stacked bars per week), plan adherence, accuracy by topic and by difficulty, weak topics list, error-type donut, mock score trend for CS and DA, syllabus coverage for each paper, streak calendar heat map, days to exam.
- **Settings**: exam date, gym window (default 17:00 to 19:00, reduces the capacity shown if it overlaps a study block), default study hours for weekday and weekend, sleep target, streak thresholds, API token reveal and regenerate, change password, export and import buttons, backup status, install help, sign out.

Routing: hash routes `#/today`, `#/plan/2026-11-02`, `#/practice/{topic}`, `#/q/{id}`, `#/cards`, `#/cards/game/pairs`, `#/log`, `#/stats`, `#/settings`. Charts: hand-rolled inline SVG (bars, lines, heat map), no chart library.

PWA specifics: `manifest.webmanifest` with `display: standalone`, `theme_color`, 192/512 and maskable icons, `start_url: /#/today`, `scope: /`. iOS needs `apple-touch-icon` and `<meta name="apple-mobile-web-app-capable">`. Persistent storage requested with `navigator.storage.persist()`. KaTeX loaded as a self-hosted subset (fonts cached by the SW), so math works offline.

## 9. Environment variables

| Var | Required | Purpose |
|---|---|---|
| `APP_PASSWORD_HASH` | yes | Argon2 hash from `bun run hash-password`. No plaintext password is stored. |
| `API_TOKEN` | yes | Bearer token for Claude, generated with `openssl rand -hex 32`. |
| `SESSION_SECRET` | yes | Used to hash session ids. |
| `DATA_DIR` | no (default `/data`) | Volume mount; holds `gate.db`, `backups/`, `media/`. |
| `PORT` | auto | Set by Railway. |
| `TZ` | no | `Asia/Kolkata`. |
| `BACKUP_KEEP` | no (default 14) | Nightly backups retained. |
| `BACKUP_PUSH_URL` | no | Optional off-site target (S3 presigned URL or Railway bucket) for the nightly copy. |

## 10. Railway deployment

1. Local: `bun install && bun run build && bun server/index.ts` on `:3000` with `DATA_DIR=./data`; run seed scripts (`bun seed/run.ts`) to load subjects, topics, videos, plan.
2. Create the project and service. Use the Railway MCP (`create-project`, `create-service`) or the CLI (`railway login` may be needed first; `railway whoami` checks) with `railway init && railway up`. Nixpacks detects Bun from `bun.lock`; build command `bun install --frozen-lockfile && bun run build`, start command `bun server/index.ts` (also set in `railway.json`).
3. Volume: `create-volume` (or `railway volume add`) mounted at `/data`, size 1 GB (enough by far). Without the volume, SQLite is wiped on every deploy, so the server refuses to start in production if `/data` is not a mount (check `RAILWAY_VOLUME_MOUNT_PATH`).
4. Variables: `set-variables` for the section 9 list. `railway.json` healthcheck path `/healthz`.
5. Replicas must stay at 1 (SQLite single writer). Deploys cause a few seconds of downtime; the PWA's offline cache hides that.
6. Domain: `generate-domain` (`*.up.railway.app`), HTTPS is automatic and required for the PWA install and service worker.
7. First-run: open the URL, log in, "Add to Home Screen". Give Claude the base URL plus `API_TOKEN` through its own secret store, never in the repo.
8. Upgrades: push and redeploy. Migrations run at startup (`PRAGMA user_version`, each file in a transaction, ahead of a pre-migration backup copy).

## 11. Backup and recovery

Layers, cheapest first
1. Nightly in-process job (a `setInterval` that fires at 02:30 IST, catching up on startup if missed): `VACUUM INTO /data/backups/gate-YYYYMMDD.db`, keep the newest `BACKUP_KEEP`. A consistent copy that is safe under WAL (never copy the raw `.db` file while writing).
2. Railway volume backups: enable the scheduled backups feature in the volume settings if available on the plan, which gives snapshot restores independent of the app.
3. Logical export: `GET /api/export` is the portable backup. A scheduled Claude routine or a laptop cron (`curl -H "Authorization: Bearer $T" .../api/export > ~/backups/gate-$(date +%F).json`) keeps off-platform copies. The study pack folder is not a git repo, so keep the exports in iCloud or Git.
4. Optional push: if `BACKUP_PUSH_URL` is set, the nightly job uploads the `.db` after step 1.

Restore drill (documented in the README): stop the service, replace `/data/gate.db` with a backup (`railway ssh` or Railway volume shell), start. Or boot an empty DB and `POST /api/import?mode=replace_tables` with the JSON export. Test the restore once after launch.

## 12. Build order (for the implementation phase)

1. Server skeleton: auth, migrations, settings, `healthz`, deploy to Railway with the volume (prove persistence early).
2. Topics, subjects, plan CRUD, seed from the study pack, Today and Plan screens, `/plan/today`.
3. Scheduler plus tests, capacity control, missed-day banner.
4. Questions, attempts, mistakes, Practice screen, bulk import. Load official-paper question stubs.
5. Check-in, streaks, mocks, jobs, Log screen, CSV import for existing files.
6. Cards, SM-2, games, Cards screen.
7. Service worker, IndexedDB snapshot, outbox and sync, install testing on the real phone (iOS Safari and Android Chrome).
8. Stats, export, backups, API README for Claude.

## 13. Risks and open questions

- Question content: official PDFs are images or PDF text, so import is semi-manual. The bulk endpoint and `needs_review` flag let Claude draft questions from PDFs, which the user then verifies (wrong answer keys are the biggest correctness risk). Copyright: the app is private, and the papers are public IIT material.
- iOS PWA limits: Background Sync is unavailable on Safari, so the outbox flushes on app open and on `online` events only. Storage may be evicted after 7 days of non-use; the server snapshot is the recovery path.
- Token blast radius: the bearer token has full access, including `/import?mode=replace_tables`. Mitigations: `plan_revisions` and pre-import automatic backup, `dry_run`, and token rotation in Settings.
- Open: whether weekday study capacity is 6 h (the plan says 6 to 6.5 h focused). Seeded at 390 min; change in Settings.
