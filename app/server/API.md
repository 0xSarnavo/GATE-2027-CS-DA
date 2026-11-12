# GATE app API (as implemented)

Base `/api`, JSON in/out. Dates `YYYY-MM-DD` (IST), timestamps ISO-8601 UTC. IDs are strings.

## Conventions
- **Auth**: cookie `sid` (from `POST /api/auth/login`) or `Authorization: Bearer <API_TOKEN>`. Everything except `/api/auth/login` and `/healthz` needs one. `/media/*` also needs auth (cookie works for `<img>`).
- **CSRF**: cookie-authenticated non-GET requests must send `X-Requested-With: app`. Bearer requests skip it.
- **Actor**: bearer => `claude`, cookie => `user`. Rows created by bearer get `created_by:"claude"` (tables with `created_by`: questions, cards, plan_tasks, topics, videos, mocks, jobs, doubts, reports).
- **Errors**: `{"error":{"code","message","details"}}`; 400 bad_json/validation, 401 unauthorized, 403 csrf, 404 not_found, 409 conflict, 422 validation|constraint|ungradable, 429 rate_limited.
- **Lists**: `?limit` (default 100, max 1000) `&cursor`; response `{items:[...], next:"<cursor>"|null}`.
- **Idempotency-Key** header on any write (all routes): a replay with the same key returns the stored 2xx response. The PWA queues failed writes in IndexedDB and replays them in order with the same key (this is its offline mechanism; `/sync/*` is for other clients).
- **PATCH** merges the fields you send; unknown fields are ignored; `null` clears nullable fields.
- JSON columns are returned parsed (`questions.options/image_refs`, `weeks.macro_goals`, `cards.tags`, `mocks.topics_to_revise`, `plan_revisions.diff`); accepted as objects or strings.
- First authenticated request of each IST day runs the **missed-day scheduler** automatically (actor `scheduler`).
- `dev`: `FAKE_TODAY=YYYY-MM-DD` pins today (ignored when `NODE_ENV=production`). `DATA_DIR` defaults to `app/.data`; `GET /api/README.md` serves this file.

## Auth / meta
| | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/login` | `{password}` | 204 + `sid` cookie (HttpOnly, SameSite=Lax, Secure on https/prod, 30d); 401; 429 after 5 tries/15 min/IP |
| POST | `/auth/logout` | | 204 |
| GET | `/healthz` (no `/api`) | | `{ok,db,version}` |
| GET | `/me` | | `{actor,server_time,today}` |
| GET | `/settings` | | `{key:"string value"}` (all values are strings) |
| PATCH | `/settings` | `{key:value,...}` | settings object. Keys include exam_date, gym_start, gym_end, tz, default_study_minutes, weekday_study_minutes (390), weekend_study_minutes (300), daily_question_goal (default 30, integer 0–200; 0 disables the question goal), sleep_target_h, job_block, streak_study_min (60), new_cards_per_day (10), job_applications_target (2), job_outreach_target (2) |

| GET | `/search` | `?q=text&limit=1..8` | `{chapters:[{id,name,parent_id}],concepts:[{topic_id,atom_id,name,snippet,topic_name}],questions:[{id,topic_id,snippet,topic_name}]}`. Case-insensitive; fewer than 2 characters returns empty groups. Results contain no answers. |

## Plan
Task object: `{id,date,sort,title,subject_id,topic_id,type,est_minutes,min_minutes,priority(1..3),fixed,status,done_minutes,carried_over_from,carry_count,origin_date,completed_at,time_block,created_by,updated_at,deleted_at,auto_done,auto_reason,auto_undone_at}`. Day task lists also include derived `task_kind` and `target_topic_id` for title-based Start actions.
`type`: study|pyq|revision|mock|GA|job|gym. `status`: todo|doing|done|skipped|moved. `fixed=1` (job, gym) never moves/scales.
Day object: `{date,week_id,available_minutes|null,day_kind,note,capacity_minutes,planned_minutes,done_minutes,tasks:[Task]}`; `day_kind`: normal|light|off|mock|travel. `capacity_minutes` is the effective capacity (null available => weekday/weekend default; off=0, light=50%). `done_minutes` uses selected study minutes by subject rather than summing sources.

| | Path | Body / query | Response |
|---|---|---|---|
| GET | `/plan` | `?from&to` (default today..+14d) | `{phases,weeks,days:[Day]}` |
| GET | `/plan/today` | `?date=` (override, for tests) | `{date,day:Day|null,tasks,available_minutes,day_kind,capacity_minutes,planned_minutes,done_minutes,questions_done,daily_question_goal,week,phase,due:{cards,mistakes},streaks,days_to_exam,missed_banner:{revision_id,at,moved,skipped,undone}|null}`. `questions_done` counts distinct questions with nonblank answers on that IST day across all attempt modes. |
| GET | `/plan/weeks` | | `{items:[week+planned_minutes+done_minutes]}` (all 20 weeks) |
| PUT | `/plan/weeks` | `{weeks:[{start_date,title?,macro_goals?,review_notes?}]}` | `{updated}` (all-or-nothing) |
| GET/PATCH | `/plan/weeks/{week_id or start_date}` | `{title?,macro_goals?:[{id?,text,done?,...}],review_notes?}` | week (`macro_goals` parsed; ids auto-assigned) |
| GET | `/plan/days/{date}` | | Day |
| PATCH | `/plan/days/{date}` | `{available_minutes?,day_kind?,note?}`; `?reschedule=false` to skip scaling | Day + `reschedule` (null or result below). Setting `available_minutes` on a day >= today runs Trigger B |
| POST | `/plan/days/{date}/capacity` | `{minutes, dry_run?, today?}` | reschedule result. dry_run leaves capacity unchanged |
| POST | `/plan/tasks` | task fields (`date,title,type` required) or `{tasks:[...]}` (max 500) | task (201) or `{tasks:[...]}`. Date must be in a seeded plan week. `fixed` defaults 1 for job/gym |
| GET/PATCH/DELETE | `/plan/tasks/{id}` | any task field | task / task / 204 (soft delete) |
| POST | `/plan/tasks/{id}/complete` | `{done_minutes?}` | task. Sets done, upserts `study_minutes` (source `task`) for the day |
| POST | `/plan/active-time` | `{id,date,kind:"study"\|"job",topic_id?:string,seconds:1..120}` | `{id,duplicate,study_minutes_total,job_minutes}`. `topic_id` is required for study; subject is resolved by the server. Repeating `id` is safe. Study batches aggregate to whole minutes under source `auto`; job batches remain separate. |
| POST | `/plan/reschedule` | `{trigger:"missed"\|"rebalance", week_start?, dry_run?, today?}` | `{changes,overflow,warnings,week_notes,revision_id,dry_run}` |
| POST | `/plan/replace` | `{from,to,tasks:[...],weeks?:[{start_date,...}],reason}` | `{revision_id,counts:{removed,added,weeks}}`. Atomically soft-deletes all `todo`/`doing` tasks in range (done/moved/skipped history kept) and inserts `tasks` (dates must be inside range) |
| GET | `/plan/revisions` | `?limit` | `{items:[{id,at,actor,reason,diff}]}` newest first |
| POST | `/plan/revisions/{id}/undo` | | `{revision_id,restored,removed}` (409 if already undone). Reverses scheduler/replace diffs |

Reschedule result: `changes:[{op:"carry"|"move"|"resize"|"skip",task_id,title,from,to,est_minutes,prev_est,reason,new_task_id?}]`. `carry` = original marked `moved`, new task on `to` with `carried_over_from`; `move` = task date changed; `resize` = est changed; `skip` = marked skipped. `overflow:[{task_id,title,est_minutes,to,action:"carried"|"skipped"|"unplaced"}]`; `week_notes` are appended to `weeks.review_notes`. `revision_id` is null for dry runs and when nothing changed.
Scheduler rules: placement fills days up to 115% of capacity, at most 40% of a day's capacity from carry-ins, most free room first (Sunday on ties); `study`/`pyq` >= 60 min may split; overflow lands on the first day of next week; priority-3 tasks that already carried twice are skipped; missed days in a light/off period or an owner profile exclusion are skipped, not redistributed; fixed tasks are skipped, never carried.

Automatic completion uses title counts and topic hints when a task has no `topic_id`. A question task needs its stated number of attempts in the chapter or subject that day; PYQs count official questions only (default 10). Study needs active chapter minutes at least the estimate or every chapter concept marked Got it. Flashcards need the stated number of reviews or a reviewed due queue that reaches zero. Job tasks need both editable daily targets or job timer minutes at least the estimate. Gym is never auto-completed. `auto_done=1` and `auto_reason` describe the evidence.

## Check-ins, streaks, log
| | Path | Body | Response |
|---|---|---|---|
| GET | `/checkins` | `?from&to` (default last 30d) | `{items:[checkin+study_minutes_total]}` |
| GET | `/checkins/{date}` | | `{date,checkin|null,study_minutes:[{subject_id,minutes,source}],effective_study_minutes:[{subject_id,minutes,source}],study_minutes_total,job_minutes,job_counts:{applications,outreach}}` |
| PUT | `/checkins/{date}` | `{gym_done?,gym_minutes?,sleep_hours?,mood?,energy?,job_applications?,referrals_sent?,revision_done?,notes?,study_minutes?:{subject_id:minutes}}` | same as GET `/checkins/{date}` + `streaks`. Upsert: omitted fields keep their value. `study_minutes` writes `source:"manual"` (0 deletes the override). `gym_done` is the quick gym log; it has no minutes or task completion. |

| GET | `/streaks` | | `{study,gym,revision,job:{current,longest,today_done}}` |
| GET | `/log` | `?from&to` (default last 7d, max 93d) | `{from,to,days:[{date,checkin,study_minutes,tasks_done,tasks_missed,tasks_open,attempts:{count,correct,time_s},cards_reviewed,mistakes_reviewed}]}` |

Selected study minutes use one source per subject and day: manual edit, then active-time `auto`, then measured `attempts`, then `task` estimate. The raw `study_minutes` array stays available for compatibility. Today’s goal, check-in totals, study streaks, and Stats use the selected values. Auto task checks run after relevant writes and hourly. They only mark open tasks done; manually undoing an automatic completion sets `auto_undone_at`, so later checks do not tick it again.

## Subjects, topics, videos
| | Path | Body / query | Response |
|---|---|---|---|
| GET | `/subjects` | | `{items:[{id,name,scope,sort}]}` |
| GET | `/topics` | `?scope=shared\|cs\|da\|foundation` (CS/DA include shared) `&subject` | `{items:[{id,subject_id,parent_id,name,scope,sort,est_minutes,notes,children:[ids],question_count,official_count,video_count,progress:{status,confidence,questions_done,questions_correct,last_studied_on}}],subjects}` |
| POST/PATCH/DELETE | `/topics[/{id}]` | `{id?,subject_id,parent_id?,name,scope,sort?,est_minutes?,notes?}` | topic / topic / 204 |
| GET | `/topics/{id}/blueprint` | | `{topic_id,summary_md,summary_full_md,atoms:[{id,name,one_line}],patterns:[{name,years,freq,note}],traps:[...],hardest_pyq}`; all null when no ladder file was imported yet |
| GET | `/topics/{id}/explainer` | | `{topic_id,title,cards:[...],scenes:[...]}` (cards empty when none). Scenes that fail `validateScene` are dropped at import with a warning |
| GET | `/topics/{id}/prereqs` | | `{chapter_id,foundations:[Prereq],chapters:[Prereq]}`. Each `Prereq` has `id,kind,name,scope,status,concept_total,got_it,mastery,ready`. `mastery` is the latest average concept score or null; `ready` is true when topic status is mastered or all available concepts are marked Got it. Empty arrays mean no mapped prerequisites. |
| GET | `/readiness/{chapter}` | | `{chapter_id,available,questions:[{id,stem,type,options?,tests}],latest:ReadinessResult\|null}`. Answers and explanations are withheld until submission; missing content returns `available:false`. |
| POST | `/readiness/{chapter}/submit` | `{answers:{[question_id]:"A"\|"number"}}` | `ReadinessResult`: `{chapter_id,correct,total,prerequisites:[{id,correct,total,ready}],questions:[{id,tests,correct,given,answer,explain}],submitted_at}`. Blank answers count as wrong; unknown question IDs return 422. The latest result is stored per chapter. |
| PUT | `/topics/{id}/progress` | `{status?,confidence?,last_studied_on?}` | progress row. status: todo\|learning\|practising\|revised\|mastered |
| GET | `/videos` | `?topic_id&subject_id` | items |
| POST/PATCH/DELETE | `/videos[/{id}]` | `{topic_id?,subject_id?,title?,url,source?,role?,language?,watched?,sort?}`; POST also `{videos:[...]}` | video / `{videos:[...]}` |
| GET | `/videos/chapter` | `?topic_id=` | `{topic_id,concepts:[{atom_id,name,video|null}],full_lectures:[Video],more_videos:[Video]}`. Each catalog video includes `concepts:[{atom_id,start_s,note}]`; a concept pick also includes `start_s`. Full lectures cover at least 60% of blueprint atoms, or have no concept map and last over 25 min. |
| GET | `/videos/concept` | `?topic_id=&atom_id=` | `{items:[Video+start_s+concepts]}`; timestamped clips first, then videos from 2025–2027, publication date descending, then lower level. |
| GET | `/videos/course` | `?subject_id=` | `{subject_id,chapters:[{id,name,sort,plan_date,topic_id,concepts,full_lectures,more_videos}]}`; leaf chapters follow first planned date, then topic sort. |
| GET / PUT | `/videos/progress` | PUT `{video_id,position_s,completed?}` | GET `{items:[{video_id,position_s,completed,updated_at}]}`; PUT upserts one row and returns it. Omitting `completed` keeps its current value. `video_id` must be an existing video. |

Curated videos also have `channel`, `lang`, `published`, `duration_s`, `level`, `why`, and mapped jump points in `video_concepts`. `GET /videos/for-concept?topic_id=&atom_id=` and `GET /videos/for-question/{id}` retain their `{video:...|null}` shape and use the same ranking. The in-app player stores a per-device resume position in localStorage and sends server progress for catalog videos. The existing `videos.watched` field remains in CRUD responses; the course tick uses `video_progress.completed`.

Topic ids are slugs (`prob.bayes`). Subject ids equal their top-level topic id (`prob`, `ds`, `ga`, ...). Raw questions that have no topic yet sit under `general.unsorted` (GA questions under `ga`).

## Questions, attempts, mistakes
Question: `{id,source:official|generated|book|custom,paper,year,session,q_no,topic_id,topic_ids:[secondary],type:MCQ|MSQ|NAT,marks,stem,options:[{key,text}]|null,answer,difficulty(1..5),order_in_topic,quick_method,solution,explanation,trap_note,video_url,video_start_s,image_refs:["img/2024-CS1-q1.png"],pdf_ref,needs_review,created_by,...}`.
`answer`: MCQ `"B"`, MSQ `"A,C"`, NAT `"12.5"` or range `"12.4..12.6"`. **Several accepted alternatives are joined with `|`** for every type: NAT `"2|3"`, MCQ `"C|D"` (either is correct), MSQ `"A,C,D|C,D"`. `"MTA"` = marks to all (everything is correct). Empty string = key unknown (`needs_review=1`; attempts must self-grade, see `/attempts`).

Content columns added by migration 0003 (all returned by `/questions`, writable via POST/PATCH):
- `level` 1..5 (generated ladder questions), `atoms` (JSON array of blueprint atom ids), `hints` (JSON array, revealed one at a time), `verified` (generated: solved twice and agreed).
- `solution`, `quick_method`, `explanation`, `trap_note` are the **Focus** (short) layer; `solution_full`, `quick_method_full`, `explanation_full`, `trap_note_full` are the **Full** layer (null = same text for both). See the `adhd-explain` skill.
- `answer_check` (`agrees|disagrees|unsure`) + `answer_check_note`: independent re-solve of the official key. The official `answer` is never overwritten by the importer.
- `answer_source`: null/`official` (official key), `official-key` (filled from an official key found later), `external` (filled from a non-official source, `needs_review=1` until a re-solve agrees), `gateoverflow` (pre-2017 community answer).
- `in_2027_syllabus` (0/1) + `syllabus_note`; `discussion_url` (GATE Overflow thread).
- Pre-2017 questions (2000-2016, `year<2017`) are `source=official`, `paper=CS`, `answer_source=gateoverflow`, `image_refs` are remote https URLs (render as-is, lazily), `q_no` is the id suffix (`12`, `GA3`, `1_21`). **Image URL = `/media/` + an `image_refs` entry**, e.g. `/media/img/2024-CS1-q1.png`; many raw MCQs have `options:null` because the options are only in the image.

| | Path | Body / query | Response |
|---|---|---|---|
| GET | `/questions` | `?topic_id` (alias `topic`; includes descendants and secondary tags) `&source&paper&year&session&type&difficulty&difficulty_min&difficulty_max&needs_review&q=text&order=difficulty` | `{items:[Question+attempt_count+last_correct],next}`. `order=difficulty` = easy->hard (difficulty, order_in_topic, year desc) |
| GET | `/questions/{id}` | | Question + `stats:{attempts,correct,avg_time_s}`, `last_attempts`, `open_mistake` |
| POST | `/questions` | question fields (`topic_id,type,stem,answer` required) or `{questions:[...]}` (max 200, one transaction) | question (201 new / 200 upsert) or `{ids,created,updated}`. Upserts by `id`, or by official key (paper,year,session,q_no). `answer` may be an array/`{ranges}` |
| PATCH | `/questions/{id}` | any field incl. `topic_ids` | question |
| DELETE | `/questions/{id}` | | 204 |
| POST | `/media` | multipart `file` (png/jpg/webp/gif, <=10 MB) | `{path:"media/<sha8>.<ext>",url:"/media/<sha8>.<ext>"}` |
| GET | `/media/img/{file}` (no `/api`) | | image from `DATA_DIR/img`, else `CONTENT_DIR/img` |
| GET | `/media/{file}` (no `/api`) | | uploaded image from `DATA_DIR/media` |
| POST | `/attempts` | `{id?,question_id,given_answer,time_s?,error_type?,mode?,at?,mock_id?,notes?,used_hint?,correct?}` | `{attempt,correct,correct_answer,mistake?}` (201; 200 `duplicate:true` if `id` seen). Server grades. Wrong answer creates the open mistake (due tomorrow) or resets it. Ungradable (no key) needs `correct` (self-grade) else 422 `ungradable`. `used_hint` marks that hints were opened |
| GET | `/attempts` | `?from&to&question_id&topic_id&correct&error_type` | items (newest first) |
| PATCH | `/attempts/{id}` | `{error_type?,notes?,used_hint?}` | attempt (also updates its open mistake's error_type). Use after reveal |
| GET | `/mistakes` | `?due=today\|all&status=open\|retired\|all` (default open) | `{items:[mistake+question]}` ordered by due |
| POST | `/mistakes/{id}/review` | `{correct,at?}` | mistake. Ladder: correct => stage+1 and due +7d (stage1), +21d (stage2), stage 3 = retired; wrong => stage 0, due tomorrow |
| PATCH | `/mistakes/{id}` | `{takeaway?,error_type?,status?}` | mistake |

## Cards and games
Card: `{id,topic_id,kind:qa|pair|cloze,front,back,hint,tags,game_ok,ease,interval_d,reps,lapses,due_on,last_reviewed_on,created_by}`.
| | Path | Body / query | Response |
|---|---|---|---|
| GET | `/cards` | `?topic_id&kind&due=today&limit&cursor` | `{items,next}` |
| POST/PATCH/DELETE | `/cards[/{id}]` | `{topic_id?,kind?,front,back,hint?,tags?,game_ok?}`; POST also `{cards:[...]}` | card / `{cards:[...]}` / 204. New cards are due today |
| GET | `/cards/due` | `?limit=30&topic_id` | `{items:[card+next_intervals:{0,3,4,5}(days)+is_new],counts:{due,new,cards,mistakes}}`. Due reviews first, then new cards, capped by `new_cards_per_day` (10) minus new cards already started today |
| POST | `/cards/{id}/review` | `{grade 0-5, time_ms?, mode?:review\|match\|recall, at?, review_id?}` or, for games, `{correct, mode, time_ms?}` (match: 4/1; recall: <3s=5, <7s=4, else 3; wrong=1) | card (updated SM-2 state) + `next_intervals` |
| GET | `/games/pairs` | `?topic_id&n=6` | `{round:[{card_id,left,right}]}` from `kind=pair` or short `qa` cards with `game_ok=1` |
| POST | `/games/scores` | `{game,topic_id?,score?,duration_s?,detail?,id?}` | score row (201) |

SM-2: grade<3 => reps 0, interval 1, lapses+1 (ease unchanged); else 1d, 6d, then round(interval*ease); ease = max(1.3, ease+0.1-(5-g)(0.08+(5-g)0.02)). UI buttons: Again 0, Hard 3, Good 4, Easy 5.

## Mocks, jobs, stats
| | Path | Body / query | Response |
|---|---|---|---|
| GET/POST | `/mocks` | `?paper&from&to`; `{date,paper:CS\|DA\|GA\|sectional,year?,session?,label?,raw_score?,max_score?,attempted_marks?,accuracy_percent?,duration_min?,unfinished?,time_issue?,topics_to_revise?:[...],notes?}` | `{items}` / mock (201) |
| GET/PATCH/DELETE | `/mocks/{id}` | | mock / mock / 204 |
| GET/POST | `/jobs` | `?response&follow_up_before`; `{company,role?,url?,date_applied?,person_contacted?,response?,next_follow_up?,notes?}` or `{jobs:[...]}` | `{items}` / job (201) / `{jobs}` |
| GET/PATCH/DELETE | `/jobs/{id}` | | job / job / 204 |
| GET | `/jobs/today` | | `{date,applications,outreach,minutes}`. Applications count dated job records or an edited check-in target, whichever is higher; outreach uses the check-in counter. |
| POST | `/jobs/outreach` | `{}` | Same as GET `/jobs/today`; increments today's outreach counter. |
| GET | `/stats/overview` | `?from&to` (default last 30d) | `{range,study_minutes_by_subject:[{subject_id,name,minutes}],by_day,accuracy_by_topic,accuracy_by_difficulty,avg_time_by_type,error_type_counts,mock_trend:{CS:[],DA:[]},plan_adherence:{planned_min,done_min,by_week},weak_topics:[{topic_id,name,accuracy,attempts,open_mistakes,score}],days_to_exam,syllabus_coverage:{cs,da:{total,started,done,pct}},streaks,heatmap:[{date,study_minutes,gym,revision,job}]}` (heatmap = last 112 days) |

## Learn and Test additions (migration 0005, all additive)
Learn module (`learn`): my notes and concept progress. Practice module (`practice`): bookmarks and tests. A concept is a blueprint atom of a chapter (`topic_id` + `atom_id`).

| | Path | Body / query | Response |
|---|---|---|---|
| GET / PUT | `/topics/{id}/note` | `{body}` (max 20000 chars) | `{topic_id,body,updated_at}` (empty body when none) |
| GET | `/notes` | | `{items:[{topic_id,body,updated_at}]}` non-empty notes |
| GET | `/concepts` | | `{items:[{topic_id,atom_id,name,one_line,has_card}]}` all concepts (blueprint atoms) |
| GET | `/concepts/progress` | `?topic_id` | `{items:[{topic_id,atom_id,status:"got_it"\|"learning",updated_at}]}` |
| PUT / DELETE | `/concepts/{topic_id}/{atom_id}` | PUT `{status?}` (default `got_it`, `null` clears) | `{topic_id,atom_id,status}` / 204 |
| GET | `/bookmarks` | | `{items:[{question_id,created_at}]}` |
| PUT / DELETE | `/bookmarks/{question_id}` | | `{question_id,bookmarked:true}` / 204 |

| GET | `/weightage` | | `{CS,DA}` each `{n_papers,subjects:{root_id:avg_marks_per_paper},chapters:{topic_id:{avg_marks,questions,years}}}` or `null`, read from `CONTENT_DIR/weightage.json` (average over tagged past papers: CS 2017 to 2026, DA 2024 to 2026; an estimate). Full mocks use `subjects` for their sampling when present |

### Tests (timed, GATE marking)
| | Path | Body / query | Response |
|---|---|---|---|
| POST | `/tests` | `{kind:"quick"\|"topic"\|"pyq"\|"mock", count?:5\|10\|15\|20, scope?}` | 201 `{id,kind,scope,allowed_s,max_score,short,questions:[Question with answer:"" and no solution fields, pos]}`. A task preset may pass `scope.task_preset:true` with an integer count from 5 to 65. `scope.easy_to_hard:true` orders a chapter's quick-test questions by difficulty. |
| POST | `/tests/{id}/submit` | `{duration_s?,answers:[{question_id,given_answer?,time_s?,marked?}]}` | result (below). 409 if already submitted |
| GET | `/tests/{id}` | | session + `questions` (answers hidden until submitted) + `result` |
| GET | `/tests` | `?limit` | `{items:[{id,kind,scope,started_at,submitted_at,allowed_s,duration_s,score,max_score,mock_id}]}` |
| GET | `/tests/papers` | | `{items:[{year,paper,session,n}]}` official papers with at least 20 questions |
| GET | `/tests/weak` | `?limit` | `{items:[{topic_id,name,attempts,accuracy}]}` chapters with accuracy < 60% over the last 60 days (>= 3 attempts) |

`scope`: quick `{topic_id?,atom?,subject?,weak?:true}` (omit for a mixed pool); topic `{topic_id}` (10 randomised questions) or `{retake_of:<test id>}` (the wrong or skipped ones only); pyq `{year,paper?,session?}` (exact questions in original order, 3 h); mock `{paper:"CS"\|"DA"}` (10 GA + 55 subject questions allocated by `MOCK_WEIGHTS`, 3 h, `short:true` when the bank has fewer than 65). Quick and topic tests draw about 30% easy, 40% medium and 30% hard and alternate official and generated questions. Out-of-syllabus and keyless questions are excluded (PYQ papers keep keyless ones, unscored). Allowed time is 90 s per 1-mark and 180 s per 2-mark question.

GATE marking: correct = marks; wrong MCQ = -1/3 (1 mark) or -2/3 (2 marks); MSQ and NAT never negative; unattempted 0; `MTA` gives full marks. Submit result: `{id,kind,mock_id,score,max_score,attempted,correct,wrong,unattempted,accuracy,duration_s,allowed_s,by_subject,by_chapter:[{id,name,total,attempted,correct,score,max,accuracy}],weak:[chapter+lost,subject_id],per_question:[{question_id,pos,topic_id,marks,type,given_answer,correct,marks_awarded,time_s,correct_answer,marked,attempt_id}]}`. Each answered question also writes an `attempts` row with `mode:"test"` (wrong ones feed the Mistakes queue). Mocks and PYQ papers also create a `mocks` row (`raw_score`, `max_score`, `accuracy_percent`, `topics_to_revise` = top 3 weak chapters), so the mock tracker and trends keep working. The client adds revision tasks for weak chapters with the existing `POST /plan/tasks`.

## Sync (offline outbox)
- `GET /sync/pull?since=<iso>&tables=a,b` => `{server_time,since,tables:{name:[rows incl. deleted_at]}}`. Default tables (snapshot): subjects, topics, topic_progress, questions, question_topics, cards, phases, weeks, plan_days, plan_tasks, videos, settings, checkins, mistakes, mocks, jobs, study_minutes. Also available via `tables=`: attempts, card_reviews, game_scores. `subjects` and `question_topics` are always sent in full. Store `server_time` and pass it as the next `since`.
- `POST /sync/push {ops:[{id,table,op:"upsert"|"delete",data,client_ts}]}` => `{applied:[ids],rejected:[{id,reason}],server_time}`. Each op id is recorded: replaying an op returns the same outcome without reapplying. Writable tables:
  - `attempts` (upsert; server grades, `data.id ?? op.id` is the attempt id), `card_reviews` (`{card_id,grade|correct,time_ms,mode,at}`), `mistake_reviews` (`{mistake_id,correct,at}`), `checkins` (`{date,...fields}`), `plan_tasks` (existing tasks only: status, done_minutes, est_minutes, title, priority, sort, time_block; `done` beats any other status; otherwise stale `client_ts` => rejected `409 stale: server row is newer`),
  - last-write-wins by `client_ts` vs row `updated_at`: `topic_progress`, `mocks`, `jobs`, `cards`, `videos`, `game_scores`. `delete` = soft delete (tables with `deleted_at`).

## Content import (tags, ladders, explainers, external checks)
`bun run import-content` (script `seed/import_content.ts`), `POST /api/import/content`, and every server boot (unless `IMPORT_ON_BOOT=0`) run the same idempotent importer over files shipped in `CONTENT_DIR` (default `app/data/`). Re-run whenever files change; missing or partial files are fine. Response of the endpoint: `{counts,warnings,files}`. Order: pre-2017 questions, tags, external cross-check, ladders (+explainers), links, WebP image refs, curated videos, review flags.
- `data/external/pre2017/*.json`: GATE Overflow scrape, tags mapped with `seed/go_tag_map.json` (deepest mapped topic wins; no match => `general.unsorted`). Existing rows are only updated while `answer_source='gateoverflow'`.
- `data/tags/<paper>.json`: `topic_ids[0]` => `questions.topic_id`, the rest => `question_topics`; `difficulty`; `in_2027_syllabus` + note.
- `data/ladders/<topic_id>.json` (spec/04-ladders.md): blueprint -> `topic_notes`; `pyq_enrichment` -> official questions (COALESCE, never replaces answers); `ladder` -> `source='generated'`, ids `gen.*`, `created_by='claude'`, invalid items skipped with a warning (bad key, duplicate id...); `flashcards` -> `cards` (`created_by='claude'`, deduped by topic+front, SM-2 state kept).
- `data/explainers/<topic_id>.json` (`_samples/` skipped): stored in `topic_explainers`.
- `data/external/answer_crosscheck.json`: `status='filled'` fills a missing answer only (official key => `answer_source='official-key'`, `needs_review=0`; otherwise `external`, `needs_review=1` until `answer_check='agrees'`); `external_answer` may be a letter, number, list, `{ranges}` or `{any_of:[...]}` (stored as `|` alternatives; ranges force `type=NAT`). `data/external/question_links.json` => `discussion_url`.
- `data/videos/<topic_id>.json`: `{topic_id,videos:[{id?,title,url|youtube_id,channel,lang,published,duration_s,level,why,concepts:[{atom_id,start_s,note?}]}]}`. Files beginning with `_` are skipped. Idempotent upsert keeps each video's `watched` value; timestamps live in `video_concepts`. `data/videos/_sample.json` documents the shape and is not imported. Curated files can be added later without changing the importer.
- Images: `image_refs` `img/x.png` is rewritten to `img/x.webp` when the WebP exists.
- Study minutes: `study_minutes` retains rows from `task`, `attempts`, `auto`, and `manual`; `effective_study_minutes` selects one per subject and day in that precedence order. A check-in edit overrides the selected amount for that subject.

## Import / export / backup
| | Path | Body / query | Response |
|---|---|---|---|
| POST | `/import` | `{mode:"merge"\|"replace_tables",dry_run?,data:{settings?,subjects?,topics?,topic_progress?,phases?,weeks?,plan_days?,plan_tasks?,plan?:{phases,weeks,days,tasks},videos?,questions?,question_topics?,cards?,card_reviews?,attempts?,mistakes?,mocks?,jobs?,checkins?,study_minutes?,active_time_batches?,game_scores?,plan_revisions?}}` or `?dry_run=1` | `{dry_run,applied,mode,counts:{created,updated,skipped},per_table,errors:[{table,index,message}],backup}`. One transaction: any error => nothing applied (422; dry runs return 200). Upsert by id, else natural key (official question key, topic subject+name, video url+topic, card front+topic, week start_date, job company+role+date). Non-dry runs first write `backups/pre-import-*.db`. `replace_tables` deletes every table present in `data` first |
| POST | `/import?table=jobs\|mocks` | `Content-Type: text/csv` (headers as in `job-search.csv` / `practice-log.csv`; `three_topics_to_revise` split on `;`) | same |
| GET | `/export` | | `{exported_at,schema_version,<every table as raw rows>,media:[{path,sha,bytes}]}`; accepted unchanged by `/import` `replace_tables` (export then import = full restore). Excludes sessions, api_log, import_runs, sync bookkeeping |
| POST | `/admin/backup` | | `{path,bytes}` (VACUUM INTO `DATA_DIR/backups/gate-YYYYMMDD-HHMM.db`) |
| GET | `/admin/backups` | | `{items:[{name,bytes,modified}]}` |
| GET | `/admin/backup/latest` | | streams the newest `gate-*.db` |
| GET | `/README.md` | | this file |

Nightly: at/after 02:30 IST a `gate-YYYYMMDD.db` is written (catch-up on startup), newest `BACKUP_KEEP` (default 14) kept; `BACKUP_PUSH_URL` gets a PUT of the file if set.

## Modules and first-run setup

All endpoints below require the existing cookie or bearer authentication. Their paths remain under `/api`.

| Method | Path | Body / response |
|---|---|---|
| GET | `/modules` | `{items:[{id,available,enabled}]}` in registry order |
| PATCH | `/modules/{id}` | `{enabled:boolean}` → `{id,enabled}`; only ids allowed by `app.config.json` or `MODULES` |
| GET | `/onboarding/status` | `{needs_setup:boolean}`; true until the first plan week exists |
| POST | `/onboarding` | `{papers:"CS"\|"DA"\|"both",startDate,examDate,weekdayHours,weekendHours,routineBlocks?:[{label,days:[0..6],start:"HH:MM",end:"HH:MM"}],breaks?:[{label?,start,end}],modules?:string[]}` → `{created:true,weeks,days}` (201). Repeating after setup returns 409. |

The generator reads `CONTENT_DIR/topics.json` in file order (or `seed/topics.json` fallback), creates foundation, coverage, and revision phases, weekly goals, daily tasks, fixed routine blocks, and lighter break days. It seeds topics and questions before inserting the plan in a transaction. Owner imports continue to use the unchanged JSON shape in `profiles/owner/plan.json`.

The deployment allowlist is `app.config.json`; `MODULES` overrides it. Settings writes `module.<id>` keys in the existing `settings` table. Disabled module API paths return the standard 404 error envelope while core authentication, import/export, sync, settings, and health routes remain available. Disabled modules do not delete their rows. `CONTENT_DIR` defaults to `./data`; `DATA_DIR` remains the writable SQLite/media directory.

## Analytics and coaching inbox

All dates use `YYYY-MM-DD` in IST. Existing API responses are unchanged.

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/digest` | `?from&to` (default last 7 days, max 366 days) | Compact period object: `from,to,settings,due,streaks,tasks,plan_tasks,weeks,minutes,attempts,mastery,mistakes,doubts,mocks,sessions,checkins,revisions,reports,study_next,priority` |
| GET | `/mastery` | `?date` (default today) | `{date,items:[{topic_id,topic_name,subject_id,atom_id,atom_name,score,attempts}],chapters:[{topic_id,name,score,attempts}],study_next}`. Concept score is a 0–100 weighted accuracy: 14-day recency half-life, difficulty L1=0.6 through L5=1.4, hinted correct=half credit. Unattempted concepts score 0. Daily concept snapshots are stored in `concept_mastery`. |
| GET | `/priority` | `?paper=CS\|DA` (CS default) | `{paper,items:[{topic_id,name,subject_id,subject_weight,accuracy,hours_remaining,attempts,expected_gain}]}` ranked by `subject_weight × (1 − accuracy) ÷ hours_remaining`. Weights come from `CONTENT_DIR/weightage.json`. |
| GET | `/strategy/{test_session_id}` | | `{session_id,median_time_s,per_question,slowest,skip_candidates,negative_marks_lost,guess_accuracy,guesses,suggested_attempt_order,sections}` after submission; `null` while a test is open. Sections are GA, 1-mark and 2-mark. Guess accuracy uses attempts explicitly labelled `error_type=guess`. |
| GET | `/analytics/period` | `?period=weekly\|monthly&from&to` | `{from,to,hours:[{subject_id,planned_min,done_min}],accuracy:[{date,attempted,correct}],mastery:[{topic_id,atom_id,gained}],study_days,plan_adherence,best_chapters,worst_chapters}` |
| GET | `/analytics/energy` | | `{items:[{date,hour,attempts,correct,sleep_hours,energy}]}`; `hour` is IST. |
| GET | `/analytics/scores` | | `{mocks,cutoffs,cutoff_points,target,cutoffs_label:"estimate"}`. Missing `CONTENT_DIR/cutoffs.json` returns `cutoffs:null` and an empty estimate state in the UI. Qualifying cutoff data accepts `{"CS":{"2024":{"general":...}},"DA":...}` or arrays of `{paper,year,general}`. `score_target` is stored in Settings. |
| GET | `/drills/questions` | `?duration_s=60\|120` | `{duration_s,items,best}`; random NAT L2–L3 questions without answers. |
| POST | `/drills/results` | `{duration_s,answers:[{id,answer}]}` | `{duration_s,correct,attempted,best}`; server grades and updates the personal best. |
| GET | `/reports` | `?limit&cursor` | `{items,next,unread}` newest first. Report: `id,kind,period_start,period_end,title,body_md,created_by,created_at,read_at`. |
| POST | `/reports` | `{kind:"daily"\|"weekly"\|"monthly",period_start,period_end,title,body_md}` | Report (201). |
| PATCH | `/reports/{id}` | `{read:boolean}` | Report; sets or clears `read_at`. |
| GET | `/doubts` | `?status=open\|answered\|all&limit&cursor` | `{items,next,unread}` newest first. Doubt: `id,ref_type,ref_id,note,status,answer_md,answered_at,read_at,created_by,created_at,updated_at`. |
| POST | `/doubts` | `{ref_type:"question"\|"concept"\|"chapter",ref_id,note}` | Doubt (201). Concept references use `<topic_id>/<atom_id>`. |
| PATCH | `/doubts/{id}` | `{note?,answer_md?,status?,read?}` | Doubt; setting `answer_md` marks answered and clears its read state. |
| GET | `/videos/for-concept` | `?topic_id&atom_id` | `{video:video+start_s+note\|null}`; best curated match by `sort`, then recency. |
| GET | `/videos/for-question/{id}` | | `{video:video+start_s+note\|null}` for the question's first atom; legacy `video_url` is the fallback. |

## Web Push reminders

Set `VAPID_PUBLIC_KEY` (base64url uncompressed P-256 point), `VAPID_PRIVATE_KEY` (base64url 32-byte private scalar), and optionally `VAPID_SUBJECT` (`mailto:` contact). Without keys, the Settings screen shows an unavailable state and the scheduler sends nothing. On iOS 16.4+, install the PWA to the Home Screen before enabling notifications. The service worker displays notifications and opens the linked screen when tapped.

| Method | Path | Body / query | Response |
|---|---|---|---|
| GET | `/push/vapid` | | `{public_key,enabled}` |
| POST | `/push/subscriptions` | Browser PushSubscription JSON `{endpoint,keys:{p256dh,auth}}` | `{ok:true}` (201) |
| DELETE | `/push/subscriptions` | `{endpoint}` | 204 |

The server scheduler checks each minute in IST, retries within a five-minute window, and records per-subscription delivery keys to avoid duplicates. Settings keys: `reminder_morning` (default `07:30`), `reminder_checkin` (`21:30`), `reminder_mistakes` (`19:00`), `reminder_quiet_start` (`22:00`), `reminder_quiet_end` (`07:00`), `reminder_gym_mute` (`1`). It also sends a reminder five minutes before `plan_tasks.time_block` starts. Quiet hours and the configured gym period suppress deliveries. `score_target` is a separate Settings key.
