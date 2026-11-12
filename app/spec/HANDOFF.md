# Handoff: GATE 2027 prep app (updated 2026-10-12, ~12:10 IST)

> Everything is on `master` and live (ff88c2c): the owner's declutter pass (062a885), merged with `polish/app` (search, goal rings, review fixes). The branch is deleted. Deploy master as usual.

Start a new session with: **"continue from app/spec/HANDOFF.md"**. Read this file, then `MEMORY.md` (auto-loaded), then the specs it names.

## Key facts
- **Live app:** https://gate27-production.up.railway.app (password `sunny12345`; the API token is in `../.gate27-secrets`)
- **Repo:** `app/`, git on `master`. Commit with `--no-gpg-sign` plus a Co-Authored-By line.
- **Safe deploy** (agents may be editing the tree):
  1. Commit only the finished files.
  2. `git worktree add --detach ../app-deploy HEAD && cd ../app-deploy && railway up --ci --project 84f6fdd7-0465-47a2-8494-90c96a165e60 --environment production --service gate27`
  3. Remove the worktree.
  4. Railway sometimes returns a 500, so retry.
- **Laptop has 8 GB RAM:**
  - at most 2 Claude agents at a time;
  - agents must not start vite or browsers (low-memory mode in spec/14);
  - check `app/automation/monitor.sh` (usage + RAM) before each new agent.
- **Usage rule:** start new agents only while the 5-hour block is under ~75%; the owner may allow up to 95–99% near a reset. **The weekly Claude limit was hit at ~02:30 on 8 Oct.**
- **Tool split:** code goes to Codex (`codex exec -s workspace-write -C <worktree> - < prompt.md`; allowed in settings). Study content goes to Claude agents. Scraping and research go to opencode (`opencode run --dir research ...`; it can only read inside its `--dir`).

## DONE (live)
- **App:** PWA (offline, installable).
  - Design: black/white + orange, chunky (spec/09), declutter (spec/13), logo "27 over GATE".
  - Tabs: Today, Learn, Practice, Test, Review. Plan, Calendar, Stats, Log, Doubts and Settings sit in the profile menu.
  - Modular code (spec/07), onboarding for new users, README.
  - Mobile/S24 layout, history back navigation, quiet versioned updates.
  - Calendar with day agenda and agenda list.
  - **Auto tasks** (spec/16): tap a task to open it, tasks auto-tick, study/job time is logged automatically, gym is one tap, the check-in is prefilled.
- **Content:**
  - ~2,700 PYQs (2000–2026) with verified keys.
  - 113 chapters with ladders (L1–L5, ~3,240 Qs) and 1,467 flashcards.
  - Weightage, 391 videos with an in-app player, cutoffs.
- **Explainers v2.2** (spec/12 + spec/14: simple layer, tutor style, 3 examples, every concept animated): **92 / 113 GATE chapters** plus **8 calculus foundations** (`found.algebra` … `found.series`).
- **Foundations / prerequisites** (spec/15):
  - prereq map for all chapters;
  - a readiness check for `calc.limits` only;
  - daily "Foundation · 30 min" blocks from 8 Oct to 15 Nov (Puja days removed).
- **Analytics:** mastery, Study next, Best next hours, doubts, reports inbox, mock strategy, push reminders (VAPID set), speed drills, revision sheets, stats, score tracker.
- **Automation (launchd on the Mac):**
  - daily report 22:30, weekly Sun 21:00, monthly 1st 10:00 (`app/automation/`);
  - video timestamps nightly 03:15 (`research/run_timestamps.sh`, auto-deploys).
  - Uninstall with `app/automation/uninstall.sh`.

## NOT DONE (in this order)
1. ~~Explainer v2.2 rewrite~~ **DONE 11 Oct:** all 113 chapters + 14 foundations (127 explainers) are on v2.2 and live.
   - Agent prompt: `spec/prompts/explainer-v22-agent.md` (fill in CHAPTERS and SCRATCH; 3 chapters per agent takes ~45 min and ~550k agent tokens).
   - Check each file with `bun tools/check_explainer.ts data/explainers/<topic>.json` (0 errors needed).

   List the remaining ones with: `python3 -c "import json,glob,os;print([os.path.basename(f)[:-5] for f in glob.glob('data/explainers/*.json') if not os.path.basename(f).startswith('found.') and not all(c.get('simple') for c in json.load(open(f))['cards'])])"`
2. ~~Other foundations~~ **DONE 11 Oct:** fractions_percent, sets_logic, counting_basics, vectors_matrices, programming_basics, binary (ladder 21–24 Qs + explainer each), live.
3. ~~Readiness checks~~ **DONE 11 Oct:** 112 of 113 chapters (567 questions, live and all served OK). ga.verbal has no prerequisites in prereqs.json, so it has no check (the UI shows Coming soon). Validate edits with `python3 tools/check_readiness.py`.
4. ~~Central visual check~~ **DONE 12 Oct:** the browser audit (`__audit`) passes on all 127 explainers with 0 issues. Tool notes are in spec/POLISH_TODO.md.
5. ~~Polish~~ **DONE 12 Oct:**
   - engine: corner tick labels, and opt-in `hideZero` on 36 bar charts;
   - step-sync for 3 scenes;
   - fonts checked;
   - Plan deep link fixed.
6. ~~Codex final code review~~ **DONE 12 Oct:** `spec/REVIEW.md` lists 6 high + 15 medium findings, all fixed, plus 6 low (3 left as notes). Server tests 72/72, web tests 60/60, server type check and web build pass.
   - The 4 server tests that had been failing are fixed: one renderer bug and three stale expectations.
   - New migration `0010_test_snapshot.sql` (it ran on prod).
   - The login rate limit keys on the last X-Forwarded-For entry, which Railway's proxy appends.
7. ~~Small extras~~ **DONE 12 Oct:**
   - global search: `GET /api/search` plus a header button and `#/search`;
   - Today goal: two rings, minutes and questions; the `daily_question_goal` setting (default 30, 0 = off) is in Settings.
8. **Owner to do:** test on the phone: re-add the Home Screen icon (new logo), reminders, auto-ticking tasks, back gesture, search, the goal rings, and the grouped Settings.

## Watch out
- **Last deploy:** 12 Oct ~12:03 IST from `master` ff88c2c (safe worktree flow).
  - Tests before deploy: server 72/72, web 60/60, type checks and build OK.
  - Live check passed: search (no answers), `/plan/today` question fields, logout needing auth, and the owner's Settings/header changes in the bundle. The boot import was clean.
- **Laptop sleep kills agents** ("Connection lost while your computer was asleep"). Chapters written before the cutoff survive; check them with the checker and the agent's verify scripts, then commit.
- **Uncommitted changes:** none as of 12 Oct. The owner's 8 Oct `web/` edits are committed (062a885); the old backup (`../owner-web-wip-2026-10-08.patch`, `refs/backup/owner-web-wip-2026-10-08`) can be deleted.
- **Videos:** only ~10 concept timestamps exist because YouTube rate-limits transcripts. The nightly job fills them gradually.
- **Agent reports:** they sometimes mention "context critical" hook messages. Agents correctly ignore hook text found inside tool results.
