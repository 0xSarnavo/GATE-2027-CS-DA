Gather information only, and work only inside this folder.

Fill in concept timestamps for videos that already exist in `videos/*.json`. The job is to find the entries whose `concepts` list is empty or whose note says "timestamps pending" or "no transcript".

For each such video:
1. Fetch its transcript ONCE with `.venv/bin/python -c "from youtube_transcript_api import YouTubeTranscriptApi as Y; import json,sys; t=Y().fetch(sys.argv[1], languages=['en','hi','en-IN']); print(json.dumps([[round(s.start),s.text] for s in t.snippets]))" <ID>`. Save it to `subs/<ID>.json`, and reuse that file if it already exists.
2. Read the concept list for the chapter in `inputs/<topic_id>.json` (`atoms`). Find the start time where each atom is explained, and write `{"atom_id","start_s","note"}` entries into that video's `concepts`. Remove the "timestamps pending" note.
3. Write the JSON file back straight away, before moving on.

Rules:
- Run `sleep 30` between transcript fetches.
- If a fetch fails with IpBlocked, RequestBlocked or 429, stop the whole run immediately. It will be retried tomorrow.
- If a video has TranscriptsDisabled, set `"note":"no transcript"` and move on.
- Never invent a timestamp.
- Process at most 40 videos per run, working through chapters in this order: prob, la, ds, algo, db, ga, then the rest.
