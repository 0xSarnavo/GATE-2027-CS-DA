-- Additive: Learn (bookmarks, notes, concept progress) and Test (sessions + answers). No existing table is altered.
CREATE TABLE bookmarks (                                        -- practice module: starred questions
  question_id TEXT PRIMARY KEY REFERENCES questions(id),
  created_at TEXT NOT NULL
);
CREATE TABLE topic_user_notes (                                 -- learn module: my free-text note per chapter
  topic_id TEXT PRIMARY KEY REFERENCES topics(id),
  body TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL
);
CREATE TABLE concept_progress (                                 -- learn module: "Got it" per concept (blueprint atom of a chapter)
  topic_id TEXT NOT NULL REFERENCES topics(id),
  atom_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'got_it' CHECK (status IN ('got_it','learning')),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (topic_id, atom_id)
);
CREATE TABLE test_sessions (                                    -- practice module: timed tests (quick, topic set, PYQ paper, full mock)
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('quick','topic','pyq','mock')),
  scope TEXT NOT NULL DEFAULT '{}',                             -- JSON: {topic_id?,atom?,subject?,weak?,year?,paper?,session?,retake_of?}
  question_ids TEXT NOT NULL DEFAULT '[]',                      -- JSON array, in presented order
  started_at TEXT NOT NULL, submitted_at TEXT,
  allowed_s INTEGER NOT NULL DEFAULT 0, duration_s INTEGER,
  score REAL, max_score REAL, detail TEXT,                      -- JSON result (breakdowns, weak chapters)
  mock_id TEXT REFERENCES mocks(id),
  updated_at TEXT NOT NULL
);
CREATE INDEX test_sessions_at ON test_sessions(started_at);
CREATE TABLE test_answers (
  session_id TEXT NOT NULL REFERENCES test_sessions(id),
  question_id TEXT NOT NULL REFERENCES questions(id),
  pos INTEGER NOT NULL,
  given_answer TEXT, correct INTEGER, marks_awarded REAL, marked INTEGER DEFAULT 0, time_s INTEGER,
  attempt_id TEXT REFERENCES attempts(id),
  PRIMARY KEY (session_id, question_id)
);
