-- Generated from spec/01-architecture.md section 5
-- ===== settings & auth =====
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
-- seeded keys: exam_date=2027-02-06, gym_start=17:00, gym_end=19:00, tz=Asia/Kolkata,
--   default_study_minutes=390, weekday_study_minutes=390, weekend_study_minutes=300,
--   sleep_target_h=7, job_block=08:00-10:00
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, created_at TEXT, expires_at TEXT);

-- ===== topics (syllabus tree) =====
CREATE TABLE subjects (          -- Engineering Maths, DSA, Algorithms, DBMS, OS, ... Probability, ML, AI
  id TEXT PRIMARY KEY, name TEXT NOT NULL, scope TEXT NOT NULL CHECK (scope IN ('shared','cs','da')),
  sort INTEGER DEFAULT 0
);
CREATE TABLE topics (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  parent_id TEXT REFERENCES topics(id),
  name TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope IN ('shared','cs','da')),   -- from 03-SYLLABUS-AND-OVERLAP.md
  sort INTEGER DEFAULT 0,
  est_minutes INTEGER,                       -- rough first-pass study time
  notes TEXT,
  updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX topics_subject ON topics(subject_id, parent_id, sort);
CREATE TABLE topic_progress (
  topic_id TEXT PRIMARY KEY REFERENCES topics(id),
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','learning','practising','revised','mastered')),
  confidence INTEGER CHECK (confidence BETWEEN 1 AND 5),     -- self rating
  questions_done INTEGER DEFAULT 0, questions_correct INTEGER DEFAULT 0,  -- denormalised cache, rebuilt from attempts
  last_studied_on TEXT, updated_at TEXT NOT NULL
);

-- ===== plan =====
CREATE TABLE phases (
  id TEXT PRIMARY KEY, name TEXT NOT NULL,         -- 'habit', 'full'
  start_date TEXT NOT NULL, end_date TEXT NOT NULL, description TEXT, updated_at TEXT NOT NULL
);  -- seed: habit 2026-10-07..2026-10-25 ; full 2026-10-26..2027-02-06
CREATE TABLE weeks (
  id TEXT PRIMARY KEY, phase_id TEXT NOT NULL REFERENCES phases(id),
  week_no INTEGER NOT NULL, start_date TEXT NOT NULL UNIQUE,   -- Monday (or 26 Oct start)
  end_date TEXT NOT NULL,
  title TEXT,                                  -- 'Probability, Bayes; C refresh'
  macro_goals TEXT NOT NULL DEFAULT '[]',      -- JSON: [{id,text,done}]
  review_notes TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE plan_days (
  date TEXT PRIMARY KEY, week_id TEXT NOT NULL REFERENCES weeks(id),
  available_minutes INTEGER,                   -- NULL = use default for weekday/weekend
  day_kind TEXT NOT NULL DEFAULT 'normal' CHECK (day_kind IN ('normal','light','off','mock','travel')),
  note TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE plan_tasks (
  id TEXT PRIMARY KEY,
  date TEXT NOT NULL REFERENCES plan_days(date),
  sort INTEGER DEFAULT 0,
  title TEXT NOT NULL,
  subject_id TEXT REFERENCES subjects(id),
  topic_id TEXT REFERENCES topics(id),
  type TEXT NOT NULL CHECK (type IN ('study','pyq','revision','mock','GA','job','gym')),
  est_minutes INTEGER NOT NULL DEFAULT 30,
  min_minutes INTEGER,                         -- smallest useful version when scaling down (NULL = unscalable)
  priority INTEGER NOT NULL DEFAULT 2 CHECK (priority BETWEEN 1 AND 3),  -- 1 = must, 3 = nice
  fixed INTEGER NOT NULL DEFAULT 0,            -- 1 = never moved/scaled (gym, job block)
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','doing','done','skipped','moved')),
  done_minutes INTEGER DEFAULT 0,              -- partial progress
  carried_over_from TEXT REFERENCES plan_tasks(id),   -- original task if this is a carry
  carry_count INTEGER DEFAULT 0,
  origin_date TEXT,                            -- date first planned
  completed_at TEXT, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX tasks_date ON plan_tasks(date, sort);
CREATE INDEX tasks_status ON plan_tasks(status, date);
CREATE TABLE plan_revisions (                  -- audit trail of every rewrite (by user or Claude)
  id TEXT PRIMARY KEY, at TEXT NOT NULL, actor TEXT NOT NULL,   -- 'user'|'claude'|'scheduler'
  reason TEXT, diff TEXT NOT NULL                                -- JSON {added:[],changed:[],removed:[]}
);

-- ===== daily check-in & habits =====
CREATE TABLE checkins (
  date TEXT PRIMARY KEY,
  gym_done INTEGER DEFAULT 0, gym_minutes INTEGER,
  sleep_hours REAL, mood INTEGER CHECK (mood BETWEEN 1 AND 5), energy INTEGER CHECK (energy BETWEEN 1 AND 5),
  job_applications INTEGER DEFAULT 0, referrals_sent INTEGER DEFAULT 0,
  revision_done INTEGER DEFAULT 0,             -- ticked, or derived from cards/mistakes reviewed
  notes TEXT, updated_at TEXT NOT NULL
);
CREATE TABLE study_minutes (                   -- per subject per day; sums feed stats
  date TEXT NOT NULL, subject_id TEXT NOT NULL REFERENCES subjects(id),
  minutes INTEGER NOT NULL, source TEXT NOT NULL DEFAULT 'manual',  -- 'manual'|'task'|'attempts'
  updated_at TEXT NOT NULL, PRIMARY KEY (date, subject_id, source)
);
-- Streaks are DERIVED (no table). habit rules, evaluated per date in IST:
--   study    : SUM(study_minutes) >= settings.streak_study_min (default 60)
--   gym      : checkins.gym_done = 1
--   revision : revision_done = 1 OR (card reviews + mistake reviews that day >= 5)
--   job      : job_applications >= 1 (weekdays only; weekends are skipped, not breaks)
-- current streak = consecutive qualifying days ending today (or yesterday if today is not yet done).
-- Longest streak and a 1-day "freeze" per 7 days are computed in lib/streaks.ts.

-- ===== question bank =====
CREATE TABLE questions (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('official','generated','book','custom')),
  paper TEXT CHECK (paper IN ('CS','DA','GA')),          -- official only
  year INTEGER, session TEXT, q_no TEXT,                  -- e.g. 2024, 'S1', '17'
  topic_id TEXT NOT NULL REFERENCES topics(id),           -- primary topic; extra via question_topics
  type TEXT NOT NULL CHECK (type IN ('MCQ','MSQ','NAT')),
  marks INTEGER NOT NULL DEFAULT 1 CHECK (marks IN (1,2)),
  stem TEXT NOT NULL,                                     -- Markdown + KaTeX ($...$)
  options TEXT,                                           -- JSON [{key:'A',text}] (MCQ/MSQ)
  answer TEXT NOT NULL,                                   -- 'B' | 'A,C' | '12.5' | NAT range '12.4..12.6'
  difficulty INTEGER NOT NULL DEFAULT 3 CHECK (difficulty BETWEEN 1 AND 5),
  order_in_topic INTEGER,                                 -- easy -> hard ordering for generated sets
  quick_method TEXT,                                      -- Markdown: "quick way" steps
  solution TEXT,                                          -- Markdown: full worked solution
  explanation TEXT,                                       -- concept explanation
  trap_note TEXT,                                         -- tricky-trap / "where people slip"
  video_url TEXT, video_start_s INTEGER,
  image_refs TEXT DEFAULT '[]',                           -- JSON ["media/2023-cs-q14-fig1.png"]
  pdf_ref TEXT,                                           -- path/page in papers/ for provenance
  needs_review INTEGER DEFAULT 0,                         -- flag for answer/solution to verify
  created_by TEXT DEFAULT 'user',                         -- 'user'|'claude'|'import'
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE UNIQUE INDEX q_official ON questions(paper, year, session, q_no) WHERE source='official' AND deleted_at IS NULL;
CREATE INDEX q_topic ON questions(topic_id, difficulty, order_in_topic);
CREATE TABLE question_topics (question_id TEXT REFERENCES questions(id), topic_id TEXT REFERENCES topics(id),
  PRIMARY KEY (question_id, topic_id));       -- secondary topic tags

CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id),
  at TEXT NOT NULL,
  given_answer TEXT, correct INTEGER NOT NULL,             -- 0/1 (NAT with range; MSQ all-or-nothing)
  time_s INTEGER,
  error_type TEXT CHECK (error_type IN ('concept','calculation','reading','time','guess')),
  used_hint INTEGER DEFAULT 0, mode TEXT DEFAULT 'practice',  -- 'practice'|'mock'|'revision'
  mock_id TEXT REFERENCES mocks(id), notes TEXT, updated_at TEXT NOT NULL
);
CREATE INDEX att_q ON attempts(question_id, at);
CREATE INDEX att_day ON attempts(at);

CREATE TABLE mistakes (                         -- one open row per question until retired
  id TEXT PRIMARY KEY, question_id TEXT NOT NULL REFERENCES questions(id),
  attempt_id TEXT REFERENCES attempts(id),      -- the attempt that created it
  error_type TEXT, takeaway TEXT,               -- one-line "what I'll do differently"
  stage INTEGER NOT NULL DEFAULT 0,             -- 0 -> due +1d, 1 -> +7d, 2 -> +21d, 3 = retired
  due_on TEXT NOT NULL, last_reviewed_on TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','retired')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX mistakes_due ON mistakes(status, due_on);
-- Review rule: correct -> stage+1, due_on = today + [1,7,21][stage]; stage 3 -> retired.
--              wrong   -> stage = 0, due_on = tomorrow.

-- ===== flashcards =====
CREATE TABLE cards (
  id TEXT PRIMARY KEY, topic_id TEXT REFERENCES topics(id),
  kind TEXT NOT NULL DEFAULT 'qa' CHECK (kind IN ('qa','pair','cloze')),
  front TEXT NOT NULL, back TEXT NOT NULL,                -- pair: front = name, back = formula
  hint TEXT, tags TEXT DEFAULT '[]', game_ok INTEGER DEFAULT 1,  -- usable in memory games (short text only)
  -- SM-2 state
  ease REAL NOT NULL DEFAULT 2.5, interval_d INTEGER NOT NULL DEFAULT 0,
  reps INTEGER NOT NULL DEFAULT 0, lapses INTEGER NOT NULL DEFAULT 0,
  due_on TEXT NOT NULL, last_reviewed_on TEXT,
  created_by TEXT DEFAULT 'user', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE INDEX cards_due ON cards(due_on) WHERE deleted_at IS NULL;
CREATE TABLE card_reviews (
  id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id), at TEXT NOT NULL,
  grade INTEGER NOT NULL CHECK (grade BETWEEN 0 AND 5), time_ms INTEGER,
  mode TEXT DEFAULT 'review',                  -- 'review'|'match'|'recall'
  updated_at TEXT NOT NULL
);
CREATE TABLE game_scores (
  id TEXT PRIMARY KEY, game TEXT NOT NULL, at TEXT NOT NULL, topic_id TEXT,
  score INTEGER, duration_s INTEGER, detail TEXT, updated_at TEXT NOT NULL
);

-- ===== mocks (replaces practice-log.csv) =====
CREATE TABLE mocks (
  id TEXT PRIMARY KEY, date TEXT NOT NULL,
  paper TEXT NOT NULL CHECK (paper IN ('CS','DA','GA','sectional')),
  year INTEGER, session TEXT, label TEXT,       -- 'CS 2024 S1', 'Made Easy sectional OS'
  raw_score REAL, max_score REAL DEFAULT 100, attempted_marks REAL, accuracy_percent REAL,
  duration_min INTEGER, unfinished INTEGER, time_issue TEXT,
  topics_to_revise TEXT DEFAULT '[]',           -- JSON up to three topic ids/names
  notes TEXT, updated_at TEXT NOT NULL, deleted_at TEXT
);

-- ===== job search (replaces job-search.csv) =====
CREATE TABLE jobs (
  id TEXT PRIMARY KEY, company TEXT NOT NULL, role TEXT, url TEXT,
  date_applied TEXT, person_contacted TEXT, response TEXT,   -- 'none'|'ack'|'screen'|'interview'|'offer'|'rejected'
  next_follow_up TEXT, notes TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT
);

-- ===== videos =====
CREATE TABLE videos (
  id TEXT PRIMARY KEY, topic_id TEXT REFERENCES topics(id), subject_id TEXT REFERENCES subjects(id),
  title TEXT, url TEXT NOT NULL, source TEXT,             -- 'GateSmashers','StatQuest','3B1B'
  role TEXT DEFAULT 'concept' CHECK (role IN ('concept','worked-example','intuition')),
  language TEXT DEFAULT 'en', watched INTEGER DEFAULT 0, sort INTEGER DEFAULT 0,
  updated_at TEXT NOT NULL, deleted_at TEXT
);

-- ===== misc =====
CREATE TABLE api_log (id INTEGER PRIMARY KEY, at TEXT, actor TEXT, method TEXT, path TEXT, status INTEGER);  -- last 5000 kept
CREATE TABLE import_runs (id TEXT PRIMARY KEY, at TEXT, actor TEXT, counts TEXT, errors TEXT);

INSERT OR IGNORE INTO settings(key,value,updated_at) VALUES
 ('exam_date','2027-02-06',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('gym_start','17:00',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('gym_end','19:00',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('tz','Asia/Kolkata',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('default_study_minutes','390',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('weekday_study_minutes','390',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('weekend_study_minutes','300',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('sleep_target_h','7',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('job_block','08:00-10:00',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('streak_study_min','60',strftime('%Y-%m-%dT%H:%M:%fZ','now')),
 ('new_cards_per_day','10',strftime('%Y-%m-%dT%H:%M:%fZ','now'));
