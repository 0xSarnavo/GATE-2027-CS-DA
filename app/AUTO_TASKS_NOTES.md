# Auto tasks implementation notes

## Done

- Task Start and row tap open Learn at the next unfinished concept, chapter past-paper questions, easy-to-hard GA questions, due cards, mistakes, Jobs, a test setup, or the Learn subject list. Existing seeded titles supply missing chapter and question-count hints.
- Additive migration `0009_auto_tasks.sql` stores automatic completion state, idempotent active-time batches, and a view that selects one study-minute source per subject and day. The order is manual edit, active time, measured attempts, then task estimate.
- Server rules run after relevant writes and hourly. They cover question and PYQ counts, active study time or all concepts Got it, card reviews or an emptied due queue, and job targets or timed job work. Automatic completions show a reason and can be undone without immediately being reticked.
- The visible web app measures Learn reader, question, test, playing video, and flashcard time. It pauses while hidden or after 120 seconds without input, sends batches every 60 seconds and on hide, and uses the existing offline outbox. Jobs has a visible pause/stop timer, application logging, and one-tap outreach logging.
- Gym is a one-tap Today/check-in log with a visible time-block reminder and no study minutes. Evening and full check-ins prefill study subjects, job minutes, and application/outreach counts. Today and Stats use selected study minutes.
- `server/API.md` documents the additive fields, endpoint, rules, and minute precedence. Tests cover title parsing, auto-completion and undo, active-time idempotency and rounding, and source precedence.

## Not done / limits

- Live iPhone, background lifecycle, and YouTube iframe playback were not exercised in this workspace. Automated tests and the production build pass.
- Broad plan titles without a resolvable chapter or subject, such as “catch-up PYQs on weak topics,” still require the user to choose the work and complete the task manually. They have no unique chapter to count against.
- No commit, deployment, or edit under `data/` was made.
