-- Content import (tags, ladders, external cross-checks). Additive only.
ALTER TABLE questions ADD COLUMN level INTEGER;                       -- ladder level 1..5 (generated questions)
ALTER TABLE questions ADD COLUMN atoms TEXT;                          -- JSON ["a1","a2"] concept atoms from the topic blueprint
ALTER TABLE questions ADD COLUMN hints TEXT;                          -- JSON ["nudge 1","nudge 2",...] revealed one at a time
ALTER TABLE questions ADD COLUMN verified INTEGER;                    -- generated: solved twice and agreed
ALTER TABLE questions ADD COLUMN answer_check TEXT CHECK (answer_check IN ('agrees','disagrees','unsure'));
ALTER TABLE questions ADD COLUMN answer_check_note TEXT;
ALTER TABLE questions ADD COLUMN answer_source TEXT;                  -- NULL/'official' | 'external' (filled from a cross-check)
ALTER TABLE questions ADD COLUMN in_2027_syllabus INTEGER NOT NULL DEFAULT 1;
ALTER TABLE questions ADD COLUMN syllabus_note TEXT;
ALTER TABLE questions ADD COLUMN discussion_url TEXT;
-- ADHD-friendly two layers: base column = Focus (short), *_full = Full. NULL *_full => UI uses the base text for both.
ALTER TABLE questions ADD COLUMN solution_full TEXT;
ALTER TABLE questions ADD COLUMN quick_method_full TEXT;
ALTER TABLE questions ADD COLUMN explanation_full TEXT;
ALTER TABLE questions ADD COLUMN trap_note_full TEXT;
CREATE INDEX q_syllabus ON questions(in_2027_syllabus);

CREATE TABLE topic_notes (                                            -- per-topic blueprint from data/ladders
  topic_id TEXT PRIMARY KEY REFERENCES topics(id),
  summary_md TEXT, summary_full_md TEXT, atoms TEXT, patterns TEXT, traps TEXT, hardest_pyq TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE topic_explainers (                                       -- data/explainers/<topic_id>.json (cards + animation scenes)
  topic_id TEXT PRIMARY KEY REFERENCES topics(id),
  title TEXT, data TEXT NOT NULL, updated_at TEXT NOT NULL
);
