# Analytics features (no AI) + scheduled AI reports

## A. In-app features: plain code, no AI, run on the server or client
1. **Concept mastery.** For each concept (atom) and chapter, compute a score from 0 to 100 from attempts:
   - weight each attempt by recency (half-life of 14 days) and difficulty (L1 = 0.6 … L5 = 1.4);
   - count hint-assisted correct answers as 0.5;
   - store per-concept snapshots daily.

   Show it as rings on Learn and Practice. **"Study next"** on Today = the weakest concept among this week's planned chapters, then any concept with mastery < 50 that has been attempted.
2. **Marks-per-hour priority.**
   - Ship `data/weightage.json` with average GATE marks per subject for CS and DA, computed from the tagged official papers 2017–2026 with a script. This is data only.
   - Expected gain = subject weight × (1 − your accuracy in that chapter) ÷ estimated hours remaining for the chapter.
   - Screen: "Best next hours", a ranked list of chapters, each with "Practise" and "Add to plan" buttons.
3. **Doubt queue.** A "Doubt" button on any question, concept or chapter.
   - The user adds a note. Rows are stored in table `doubts` (id, ref_type, ref_id, note, status open/answered, answer_md, answered_at, created_by).
   - API: GET/POST /api/doubts and PATCH /api/doubts/:id.
   - UI: a Doubts list in Review that shows answers (Markdown + KaTeX) and a badge for new answers.
4. **Mock strategy analysis.** For test sessions, show:
   - time per question vs the marks it carried;
   - the slowest questions;
   - skip candidates (more than 2× the median time and wrong);
   - negative marks lost and guess accuracy;
   - suggested attempt order (GA → 1-mark → 2-mark, or whatever beats your history);
   - a section time split.
5. **Reminders.** Web Push (VAPID keys as env vars; the `web-push` protocol implemented server-side, or one tiny dependency if unavoidable). iOS 16.4+ only works for the Home-Screen app, so show a guided "Enable reminders" flow.
   - Schedules in Settings: morning plan at 07:30, next block 5 min before each time block, check-in at 21:30, mistakes due. Plus quiet hours and a gym-time mute.
6. **Weekly / monthly stats screens (non-AI):**
   - hours planned vs done per subject;
   - questions attempted and accuracy trend;
   - mastery gained;
   - streak days;
   - best and worst chapters;
   - plan adherence.
7. **Speed drills.** 60s or 120s rounds of NAT calculation questions (tagged numeric, L2–L3) using the virtual calculator, with personal bests.
8. **Revision sheets.** One printable page per subject (print CSS → Save as PDF): formula flashcards, top traps, your most-missed concepts.
9. **Energy vs performance.** Chart accuracy against sleep hours, energy (from check-in) and time of day.
10. **Score tracker.**
    - Mock score trend against past qualifying cutoffs, plus a target line set in Settings.
    - Uses `data/cutoffs.json`: GATE CS/DA qualifying cutoffs 2024–2026 and, where public, target programme data. It is gathered by an info-gathering run and labelled "estimate".
11. **Reports inbox.** Table `reports` (id, kind daily/weekly/monthly, period_start, period_end, title, body_md, created_by, created_at), with API GET/POST /api/reports. A "Reports" screen under the profile menu with an unread badge.

All migrations are additive, API.md is updated, and everything has tests.

## B. Scheduled AI runs on the owner's laptop
- **macOS launchd user agents** in `~/Library/LaunchAgents/com.gate27.{daily,weekly,monthly}.plist`. launchd runs a missed calendar job when the Mac wakes, so a report runs even if the laptop was asleep at the scheduled time.
- **Schedule:**
  - Daily 22:30
  - Weekly: Sunday 21:00
  - Monthly: 1st of the month 10:00
- **Wrapper:** `app/automation/run.sh <kind>` does the following:
  1. Loads `API_TOKEN` from `.gate27-secrets`.
  2. Takes a lock, so two runs never overlap.
  3. Runs headless `claude -p` with:
     - a small model (`--model sonnet`);
     - restricted tools (`Bash(curl:*)`, `Read` and `Write` only inside `reports/`);
     - the prompt file `app/automation/prompts/<kind>.md`.
  4. Logs to `GATE-2027-CS-DA/reports/logs/`.
- **What each run does,** reading from the API and writing back through it:
  - **Daily:**
    - summarise today (tasks done vs planned, minutes, accuracy, new mistakes);
    - answer open doubts by PATCHing `answer_md`;
    - make sure missed tasks are rescheduled;
    - post the report to /api/reports;
    - save a copy to `reports/daily/YYYY-MM-DD.md`.
  - **Weekly:**
    - a review of what improved, what slipped and why, using mastery and accuracy deltas;
    - next week's focus;
    - adjust next week's plan via /api/plan (rebalance, add revision for the weakest chapters, honouring capacity);
    - post the report.
  - **Monthly:**
    - progress against the exam timeline (projected syllabus completion date vs exam);
    - mock trend;
    - recommendations for hours and priorities;
    - post the report.
- **Uninstall:** `app/automation/uninstall.sh` unloads and removes the plists.
- **Cost control:** small model, a hard `--max-turns`, and a compact JSON API digest endpoint (`GET /api/digest?from&to`) so the model reads one response instead of many.
