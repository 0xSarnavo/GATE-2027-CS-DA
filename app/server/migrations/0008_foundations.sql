-- Additive scope extension: legacy CHECK constraints still store shared; the
-- effective scope is held in scope_override for foundation rows.
ALTER TABLE subjects ADD COLUMN scope_override TEXT;
ALTER TABLE topics ADD COLUMN scope_override TEXT;
CREATE TABLE topic_prereqs (
  topic_id TEXT NOT NULL REFERENCES topics(id),
  prereq_id TEXT NOT NULL REFERENCES topics(id),
  kind TEXT NOT NULL CHECK (kind IN ('foundation','chapter')),
  sort INTEGER NOT NULL,
  PRIMARY KEY (topic_id, prereq_id)
);
CREATE TABLE readiness_results (
  chapter_id TEXT PRIMARY KEY REFERENCES topics(id),
  result_json TEXT NOT NULL,
  submitted_at TEXT NOT NULL
);
