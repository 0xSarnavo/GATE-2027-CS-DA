# Information architecture: Learn · Practice · Test

Hierarchy everywhere: **Subject → Chapter → Concept**.
- **Subject** is a root topic in `seed/topics.json`, such as Algorithms or Probability.
- **Chapter** is a leaf topic, such as `algo.dp`.
- **Concept** is a blueprint *atom* inside that chapter's ladder file, also the explainer card `atom_id`.

Ladder questions carry `atoms[]`, so every question maps to a concept.

## Tabs (phone)
**Today · Learn · Practice · Test · Review**. Plan, Log, Stats and Settings live under a profile/menu button in the top bar, and the desktop rail shows all of them. Each tab respects module toggles: Learn belongs to the `learn` module, Practice to `practice`, Test to `practice`/`mocks`, and Review to `review`.

## Learn
- **Subject list:** a colour band per subject (CS blue, DA purple, shared green, GA gold), with progress = concepts learned / total.
- **Chapters:** shows the subject's chapters with a short summary and concept count.
- **Concepts:** the chapter page lists its concepts. Each opens the explainer card (Focus default, Full on tap) with its animation scene, plus "Try a question", which jumps to the first L1/L2 ladder question for that atom.
- **Chapter note:** the blueprint `summary_md` / `summary_full_md` sits at the top as the chapter note.
- **Formula sheet** per chapter, built from the flashcards whose `kind` is `formula`.
- **My notes:** a free-text note per chapter (stored server-side, additive table `topic_user_notes`).
- **Progress:** mark a concept as "Got it", stored server-side (additive table `concept_progress`). This drives the Learn progress.

## Practice (untimed, learn-by-doing)
- **Scope picker:** All, or Subject → Chapter → Concept (breadcrumb chips).
- **Filters:** source (generated ladder / official PYQ / pre-2017), type (MCQ/MSQ/NAT), difficulty or level, status (new / wrong before / bookmarked), and outside-syllabus (hidden by default).
- **Order:** easy → hard by default, with a "Shuffle" option.
- **Modes:**
  - **Path:** the zig-zag level path per chapter, L1→L5 then PYQs.
  - **Free practice:** the filtered list.
  - **Mistakes:** the due spaced-review queue.
- **Bookmarks:** a star on any question (additive table `bookmarks`).

## Test (timed, exam-like)
- **Quick test:** 5, 10, 15 or 20 questions, randomised from the chosen scope (Subject / Chapter / Concept / mixed weak areas), with a mix of sources and difficulty. Timer is about 1.5 min per 1-mark question and 3 min per 2-mark question.
  - Scored with GATE marking: MCQ −1/3 or −2/3, MSQ and NAT no negative.
- **Topic test sets:** pre-built sets of 10 per chapter, randomised each attempt, plus a "Retake wrong only" option.
- **PYQ paper mode:** pick a year and paper (CS1, CS2, DA, …) and get the exact 65 questions in original order. Timed at 3 h, GATE scoring.
- **Full mock:** 65 questions (10 GA + 55 subject) sampled by GATE's subject weightage, in a 3 h **GATE-style interface**:
  - question palette (not visited / not answered / answered / marked for review / answered + marked);
  - section switch;
  - mark for review;
  - clear response;
  - save & next;
  - on-screen **virtual scientific calculator**, matching GATE's basic and scientific functions.
- **Results:**
  - score, accuracy, attempted, time per question, subject-wise and chapter-wise breakdown;
  - a weak chapters list with "Practise these" (pre-scoped Practice) and "Add to plan" (calls the plan API to add revision tasks);
  - wrong answers flow into the Mistakes queue with error types.
- **Storage:** additive tables `test_sessions` (id, kind, scope, question_ids, started_at, submitted_at, duration_s, score, max_score, detail JSON) and `test_answers`. Each answer also writes an `attempts` row with `mode='test'`. Full mocks also create a `mocks` row, so the existing mock tracker and trends keep working.

## Today additions
- **Daily goal ring:** study minutes plus questions.
- **"Today's mix":** a 10-question quick test from due mistakes and this week's chapters.
- **GA daily 5.**

## Ranking of extra features
1. GATE-style full mock interface with virtual calculator
2. Quick/topic tests with GATE scoring and weak-area feedback into the plan
3. PYQ paper mode
4. Bookmarks + my notes + formula sheets
5. Global search (questions, chapters, concepts)
6. Weekly review screen (what improved, what slipped, next week's focus)
