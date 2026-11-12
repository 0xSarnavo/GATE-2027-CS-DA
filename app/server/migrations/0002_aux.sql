-- Additions beyond spec section 5 (additive only).
-- Idempotency / sync outbox bookkeeping
CREATE TABLE idempotency (key TEXT PRIMARY KEY, method TEXT, path TEXT, status INTEGER, body TEXT, at TEXT NOT NULL);
CREATE TABLE sync_ops (id TEXT PRIMARY KEY, at TEXT NOT NULL, ok INTEGER NOT NULL, reason TEXT);
-- Time-block label for plan tasks ('08:00-10:00'), used by the Today screen
ALTER TABLE plan_tasks ADD COLUMN time_block TEXT;
-- created_by badge ('user'|'claude'|'import'|'seed') on rows Claude may author
ALTER TABLE plan_tasks ADD COLUMN created_by TEXT DEFAULT 'user';
ALTER TABLE topics ADD COLUMN created_by TEXT DEFAULT 'user';
ALTER TABLE videos ADD COLUMN created_by TEXT DEFAULT 'user';
ALTER TABLE mocks ADD COLUMN created_by TEXT DEFAULT 'user';
ALTER TABLE jobs ADD COLUMN created_by TEXT DEFAULT 'user';
CREATE INDEX att_topic_day ON attempts(mode, at);
CREATE INDEX cr_card ON card_reviews(card_id, at);
CREATE INDEX cr_at ON card_reviews(at);
CREATE INDEX q_updated ON questions(updated_at);
