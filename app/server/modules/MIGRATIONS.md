# Schema ownership

The original schema in `server/migrations/0001_init.sql` and `0002_aux.sql` predates modules. Its table ownership is:

| Module | Tables |
|---|---|
| Planner | `phases`, `weeks`, `plan_days`, `plan_tasks`, `plan_revisions`, `active_time_batches` (0009) |
| Practice | `subjects`, `topics`, `topic_progress`, `questions`, `question_topics`, `attempts`, `mistakes`, `topic_notes`, `bookmarks`, `test_sessions`, `test_answers` |
| Learn | `videos`, `video_concepts`, `video_progress`, `topic_explainers`, `topic_user_notes`, `concept_progress` |
| Review | `cards`, `card_reviews`, `game_scores` |
| Mocks | `mocks` |
| Habits | `checkins`, `study_minutes` |
| Jobs | `jobs` |
| Insights | `doubts`, `reports` |
| Core | `settings`, `sessions`, `api_log`, `import_runs`, sync/idempotency tables |

`0003_content.sql` owns practice/learn content additions. `0004_modules.sql` adds planner/jobs indexes; module preferences use the existing `settings` table. `0006_analytics.sql` adds practice mastery and drill bests, learn video metadata and `video_concepts`, insights inbox tables, and habits push subscription/delivery tables. `0007_video_progress.sql` adds learn video progress. Future module migrations remain numbered in `server/migrations/` so startup applies them in one ordered, transactional sequence. Disabling a module never drops its tables.
