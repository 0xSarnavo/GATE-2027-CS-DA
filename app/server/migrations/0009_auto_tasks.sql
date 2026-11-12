-- Additive task automation and idempotent active-time batches.
ALTER TABLE plan_tasks ADD COLUMN auto_done INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plan_tasks ADD COLUMN auto_reason TEXT;
ALTER TABLE plan_tasks ADD COLUMN auto_undone_at TEXT;

CREATE TABLE active_time_batches (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('study','job')),
  topic_id TEXT REFERENCES topics(id),
  subject_id TEXT REFERENCES subjects(id),
  seconds INTEGER NOT NULL CHECK (seconds BETWEEN 1 AND 120),
  created_at TEXT NOT NULL
);
CREATE INDEX active_time_day ON active_time_batches(date,kind,topic_id);

-- One chosen source per subject and day. Manual overrides auto, which overrides
-- measured attempts, which overrides task estimates. Never add these sources.
CREATE VIEW effective_study_minutes AS
SELECT date,subject_id,minutes,source FROM (
  SELECT date,subject_id,minutes,source,
    ROW_NUMBER() OVER (PARTITION BY date,subject_id ORDER BY
      CASE source WHEN 'manual' THEN 0 WHEN 'auto' THEN 1 WHEN 'attempts' THEN 2 ELSE 3 END) AS rank
  FROM study_minutes WHERE minutes > 0
) WHERE rank=1;
