-- Analytics snapshots, inboxes, push and curated video metadata. All changes are additive.
CREATE TABLE concept_mastery (
  date TEXT NOT NULL, topic_id TEXT NOT NULL REFERENCES topics(id), atom_id TEXT NOT NULL,
  score INTEGER NOT NULL, attempts INTEGER NOT NULL, PRIMARY KEY(date,topic_id,atom_id)
);
CREATE TABLE doubts (
  id TEXT PRIMARY KEY, ref_type TEXT NOT NULL CHECK(ref_type IN ('question','concept','chapter')),
  ref_id TEXT NOT NULL, note TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','answered')),
  answer_md TEXT, answered_at TEXT, read_at TEXT, created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX doubts_status ON doubts(status,created_at);
CREATE TABLE reports (
  id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('daily','weekly','monthly')),
  period_start TEXT NOT NULL, period_end TEXT NOT NULL, title TEXT NOT NULL, body_md TEXT NOT NULL,
  created_by TEXT NOT NULL, created_at TEXT NOT NULL, read_at TEXT
);
CREATE INDEX reports_created ON reports(created_at);
CREATE TABLE push_subscriptions (
  endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, created_at TEXT NOT NULL, last_sent_at TEXT
);
CREATE TABLE reminder_deliveries (key TEXT PRIMARY KEY, sent_at TEXT NOT NULL);
CREATE TABLE speed_drill_bests (duration_s INTEGER PRIMARY KEY, best_correct INTEGER NOT NULL, best_attempted INTEGER NOT NULL, achieved_at TEXT NOT NULL);
ALTER TABLE videos ADD COLUMN channel TEXT;
ALTER TABLE videos ADD COLUMN lang TEXT;
ALTER TABLE videos ADD COLUMN published TEXT;
ALTER TABLE videos ADD COLUMN duration_s INTEGER;
ALTER TABLE videos ADD COLUMN level INTEGER;
ALTER TABLE videos ADD COLUMN why TEXT;
CREATE TABLE video_concepts (
  video_id TEXT NOT NULL REFERENCES videos(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL REFERENCES topics(id), atom_id TEXT NOT NULL,
  start_s INTEGER NOT NULL DEFAULT 0, note TEXT,
  PRIMARY KEY(video_id,topic_id,atom_id)
);
CREATE INDEX video_concepts_lookup ON video_concepts(topic_id,atom_id,start_s);
