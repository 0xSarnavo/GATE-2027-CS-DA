CREATE INDEX IF NOT EXISTS idx_plan_tasks_date_live ON plan_tasks(date, sort) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_jobs_followup_live ON jobs(next_follow_up) WHERE deleted_at IS NULL;
