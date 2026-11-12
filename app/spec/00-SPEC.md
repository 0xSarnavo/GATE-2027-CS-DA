# GATE 2027 Prep App — Spec overview

Personal, single-user, mobile-first PWA. Detailed specs:
- `01-architecture.md`: stack and why, database DDL, API, offline sync, scheduler, screens, deploy, backups
- `02-study-plan.md`: phases, weekly macro goals, daily micro template, adaptive rules (seed: `../seed/plan.json`, `../seed/topics.json`)
- `03-question-pipeline.md`: paper extraction results and the enrichment and generation plan (data: `../data/questions/`)

## Architecture in one paragraph

One Railway service runs Bun + Hono, with SQLite on a Railway volume (`/data`). The same server serves the API and the built Preact PWA, so there is one origin and no CORS. The UI uses a password login with a cookie. Claude uses a bearer token on the same API, and every row Claude writes is tagged `created_by='claude'`. The app works offline: a service worker plus an IndexedDB snapshot, with offline writes queued in an outbox and synced on reconnect.

**Why this stack:**
- A single user does not need Postgres or a separate frontend host. One file DB is cheap, fast and trivially backed up.
- Bun bundles SQLite and TypeScript, so there are fewer dependencies than with Node + better-sqlite3.
- Preact gives React ergonomics at about 4 KB, which keeps the phone app fast.
- Hono is tiny and typed. Runtime deps are only hono, preact and idb-keyval.

## Feature list (v1)

| Area | What you get |
|---|---|
| Today | Time-blocked tasks for the day, tick off, "hours available today" slider that rescales the day, carry-overs marked |
| Plan | 20 weeks of measurable macro goals with progress; phases: habit (7–16 Oct), Puja (17–21), ramp (22–25), full (26 Oct–5 Feb), exam window |
| Adaptive scheduler | Missed tasks are spread over the following days by priority. No day goes above 115% of its capacity, overflow moves to the next week, and every change is logged |
| Practice | Topic → questions ordered easy to hard (PYQ + generated). Each has an attempt, then reveal answer, quick method, concept explanation, trap notes and a topic video. Time and error type are recorded |
| Mistakes | Automatic spaced revision at 1 day, 1 week and 3 weeks |
| Cards and games | SM-2 flashcards (formulas, definitions, traps), plus match-pairs and timed-recall games that feed the same review schedule |
| Log | Daily check-in (study minutes per subject, gym, sleep, energy, notes, job apps); mock-paper tracker; job tracker |
| Stats | Streaks (study/gym/revision/job), hours versus plan, accuracy by topic, mock trend |
| Settings | Gym window (default 17:00–19:00 Mon–Sat), weekday study minutes (390), exam date |
| API for Claude | Read logs and notes, reschedule or replace the plan, bulk add questions, cards and videos, import (with dry-run) and export everything |

## Question bank status
- **Extracted:** 19 papers and 1225 questions. Every keyed paper gives exactly 65 questions. Questions with math, figures or code also carry a crop image.
- **Keys:** the 2017, 2019 and 2020 keys were embedded inside the paper PDFs, and the pipeline found them.
- **Flagged for review: 106.** These are 31 unread 2020 MCQ answers (the key is a low-resolution image), about 13 OCR misses, 8 questions with figure options, and the 55-question DA sample (no key).
- **Enrichment:** each question gets topic tags, difficulty 1–5, a quick-solve method, a concept explanation and trap notes. This runs in about 38 agent batches, with a separate agent verifying answers.
- **Generated practice:** about 750–1000 original questions per topic, ordered easy to hard, with a blind-solve QA pass.

## Build order
1. Server, DB schema, auth, seed loader (plan, topics, raw questions), scheduler with tests
2. PWA shell: Today, Plan, Log/check-in, Settings, offline sync. **Deploy to Railway, usable from 7 Oct**
3. Practice screen on the raw questions (images and answers)
4. Enrichment batches imported via the API as they finish (in the background, over days)
5. Flashcards and games, Stats
6. Generated practice questions per topic, front-loading the topics of the coming weeks

## Decisions taken (change any)
- Gym Mon–Sat 17:00–19:00, Sunday off; weekday study 6.5 h
- The first paper is assumed to be 6 Feb 2027
- Topic ids are subject-prefixed (`prob.bayes`), so a shared topic has one id for both papers
- About 140 MB of question images live on the volume, not in git
