CREATE TABLE video_progress (
  video_id TEXT PRIMARY KEY REFERENCES videos(id) ON DELETE CASCADE,
  position_s INTEGER NOT NULL DEFAULT 0 CHECK(position_s >= 0),
  completed INTEGER NOT NULL DEFAULT 0 CHECK(completed IN (0,1)),
  updated_at TEXT NOT NULL
);
