Gather information only. Do not write app code, and do not edit anything outside `videos/ in this folder`.

Goal: for each chapter (topic id) listed at the end of this prompt, find the best YouTube videos that teach it for GATE CS/DA. Use their transcripts to map concepts to timestamps.

For each chapter:
1. Read `inputs/<topic_id>.json (relative to this folder)`. Its `atoms` lists the concepts (`id`, `name`, `one_line`) and `patterns` lists the GATE question patterns.
2. Find candidate videos. Use web search, or run `.venv/bin/yt-dlp "ytsearch8:<query>" --flat-playlist --print "%(id)s|%(title)s|%(channel)s|%(duration)s|%(upload_date)s"`. Search in English and Hinglish, for example "<chapter> GATE CSE", "<chapter> GATE DA 2026", "<concept> explained".
   - **Prefer** videos uploaded in 2025–2026 (GATE 2026/2027 batches), or the newest GATE-specific ones.
   - **Older videos are fine only if they explain the concept itself**, for example StatQuest, 3Blue1Brown, NPTEL lectures, Neso Academy, Abdul Bari or Gate Smashers concept videos. Skip old "exam strategy" or "paper analysis" videos.
   - Avoid paywalled course trailers, shorts under 3 minutes (unless a crisp single-concept explainer), and videos with clickbait-only content.
3. Pull the transcript of each candidate with `.venv/bin/python -c "from youtube_transcript_api import YouTubeTranscriptApi as Y; import json,sys; t=Y().fetch(sys.argv[1], languages=['en','hi','en-IN']); print(json.dumps([[round(s.start),s.text] for s in t.snippets]))" <VIDEO_ID>`, or `yt-dlp --write-auto-subs --skip-download`. Use the transcript to:
   - confirm the video really teaches this chapter's concepts, rejecting it otherwise;
   - find the start time (in seconds) where each concept (atom) is explained;
   - judge quality: is it clear, does it use worked examples, does it go to GATE depth?
4. Pick 2–4 videos per chapter. Together they should cover all atoms if possible, with at least one English video. Add Hinglish where it is the clearer source.

Write `videos/ in this folder<topic_id>.json`:
```json
{"topic_id":"...","checked_at":"YYYY-MM-DD","videos":[{"id":"VIDEO_ID","url":"https://www.youtube.com/watch?v=VIDEO_ID","title":"...","channel":"...","lang":"en|hi|hinglish","published":"YYYY-MM-DD","duration_s":0,"why":"one line: what it covers well","level":"intro|gate|advanced","concepts":[{"atom_id":"a1","start_s":123,"note":"what is explained there"}]}],"uncovered_atoms":["a7"]}
```

Rules:
- Every timestamp must come from a real transcript you fetched. Never guess one.
- If no transcript is available, you may keep a strong video, but give it an empty `concepts` list and set `"note":"no transcript"`.
- Write each chapter's file as soon as it is done.
- Skip a chapter whose output file already exists.

**Rate-limit rules (YouTube has been rate-limiting this machine):**
- Write any temporary or subtitle files ONLY inside `subs/` in this folder. Never write to /tmp.
- Fetch at most 2 transcripts per chapter. Wait at least 20 seconds between transcript fetches (`sleep 20`).
- If a fetch returns IpBlocked, RequestBlocked or 429 / Too Many Requests, STOP fetching transcripts for the rest of this run. Still pick the videos using titles, channel, date and description (`yt-dlp --print "%(description)s"` is fine). Leave `concepts` as [] with `"note":"timestamps pending"` so a later pass fills them.
- Prefer channels and playlists already known to be good, to cut down on searches.
