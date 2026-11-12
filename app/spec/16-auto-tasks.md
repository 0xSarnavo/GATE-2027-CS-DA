# Tasks that open, tick and log themselves (owner request, 2026-10-07)

1. **Tap a task to go there** (a "Start" action on every task; the task row tap opens it too):
   - Linked chapter (`topic_id` or found.*): study / foundation tasks open the Learn concept reader at the first not-yet-"Got it" concept.
   - "PYQs: …": open Practice for that chapter, past-paper list.
   - "GA practice: … (N Qs)": start an N-question session from that GA chapter, easy to hard.
   - flashcards / revision: open the due cards.
   - mistakes: open the mistakes queue.
   - job: open the Jobs tracker.
   - mock / test: open the Test setup with the right preset.
   - syllabus walk: Learn subjects list.
   - Parse N and the topic from titles where `topic_id` is missing, with a mapping table for seeded titles (GA verbal/quant/analytical/spatial, Python, C, Counting…).
2. **Auto-complete tasks** (server-side rule check after relevant events, plus an hourly sweep; never un-tick a manual tick):
   - "N Qs" tasks: N attempts today in that topic or subject.
   - study / foundation tasks: active minutes today in that chapter ≥ the task estimate, OR every concept of the chapter is "Got it".
   - pyq tasks: N past-paper attempts in that chapter (default 10).
   - flashcards: due count reaches 0 today, or ≥ N reviews.
   - job: today's job log reaches the targets (applications ≥ 2 and outreach ≥ 2, settable), or the job timer reaches the estimate.
   - Store `auto_done=1` and the reason. The UI shows "Done automatically · 10/10 questions" and supports undo.
3. **Automatic time logging:**
   - Active-time tracker in the web app: count time while the app is visible AND the user is in the Learn reader, a question or test session, the video player (while playing) or flashcards. Pause after 120 s without input, or when hidden. Attribute minutes to topic_id and subject. Batch-send every 60 s and on hide, via the offline outbox.
   - Server: `study_minutes` with source='auto'.
   - Job time: the job task's Start opens the Jobs tracker and starts a visible timer (pause/stop). Its minutes are logged as job time. Logging an application or outreach in the tracker also counts.
   - Evening check-in is pre-filled with the auto study minutes per subject, job minutes and applications. The user edits only if needed and adds sleep, energy, mood and gym.
4. **Gym is a quick manual log.** It is a one-tap "Gym done" toggle on Today (and in the check-in), not a timed task: no minutes and no auto-complete. It counts toward the gym streak. Keep the 17:00–19:00 block visible as a reminder only.
5. Today's goal ring and Stats use auto minutes. Remove the double counting of manual + task + auto minutes: the priority order is manual edit, then auto, then task estimate.
