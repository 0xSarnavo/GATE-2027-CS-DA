# 03 - Question pipeline (PDF -> question bank -> enriched bank)

Stage 1 (done, deterministic): `app/tools/extract_papers.py` turns every official paper PDF into `app/data/questions/<paper-id>.json` plus PNG crops in `app/data/img/`.
Stage 2 (next, AI agents, batched per paper): tagging, difficulty, solving shortcuts, explanations, traps, answer verification.
Stage 3 (next): original practice questions per topic, with QA.

Run: `app/tools/.venv/bin/python app/tools/extract_papers.py [paper-id ...] [--no-ocr]` (full run about 3 min with a warm OCR cache, about 10 min cold). Deps: `pymupdf`, `pillow`, `numpy`, and `pyobjc-framework-Vision` (macOS Vision OCR, needed only for the scanned papers; no tesseract on this machine). Source PDFs in `papers/` are only ever read.

## 1. Format findings

| Papers | Text layer? | Layout | Key |
|---|---|---|---|
| CS 2018 | yes | One column, `Q.n` then text, `(A)..(D)` on own lines. GA Q1-10 then CS **Q1-55 restart** (key restarts too). Math is Unicode italic (𝜋𝑑2), fractions come out stacked. | separate `*-key.pdf`, text, columns Q.No/Type/Section/Key/Marks |
| CS 2022 | yes | Table-style: `Q.n` and options in bordered table cells. Math partly in symbol font (private-use glyphs like `` for theta). Numbering continuous 1-65. | separate key, text, has Session column |
| CS 2023 | yes | Every question in a one-row-per-option table, **one question per page**, footer `Page n of 83`. | separate key, text |
| CS 2024-2026 (CS1, CS2), DA 2024-2026 | yes | Clean born-digital. `Q.n` / `(A)` markers, MSQ and NAT introduced (MCQ 1/2 marks, MSQ 1/2, NAT 1/2). Watermark image on every page, logo in header. Math in Unicode math italic; figures as raster images. | separate key, text; Session column present (2024-CS key has none). Some DA keys use `MTA` (marks to all) |
| DA 2024 sample | yes | 55 subject questions, no GA, Q1-25 one mark, Q26-55 two marks. PDF says no key will be published. | none |
| CS 2017 (2 sessions, one PDF) | headers only | Third-party (BYJU'S) re-typeset. Question bodies, options, tables are **images**; only `Question Number : n  Correct : 1  Wrong : -0.33` and the key are text. Two 65-question sessions in one file; GA is Q56-65. Questions are laid out in odd order on page (Q2 above Q1), so sort by y. | **embedded** at end of each session (text) |
| CS 2019 | **none** (pure scan, 215 images) | Full-page images, `Q.n` label in a left margin column. GA 1-10, then CS 1-55. | **embedded** key, image table (3 pages), `C OR D` style entries exist |
| CS 2020 | anchors only | Bodies are images; text layer has `Q.No. n`, `(A)`, section headings. GA 1-10 then CS 1-55. | **embedded** as a low-res web screenshot (2 pages, cells rasterised) |
| CS 2021 (Set 1 + Set 2 in one PDF, 91 pages) | **none** | Each page is cut into 12 image strips; every question is a bordered table. Pages 42-45 are an embedded key; separate `2021-CS-key.pdf` (image, 6 pages: 3 per set) is used instead. | image key, columns Q.No/Session/Type/Section/Key/Marks/Negative |

Common facts:
- Question numbers: 65 per paper (GA 10 + subject 55). GA marks: Q1-5 = 1, Q6-10 = 2. Subject: Q1-25 = 1, Q26-55 = 2 (same rule every year 2017-2026; the key confirms it).
- Types: MCQ only (2017-2020), MCQ+MSQ+NAT from 2021. Negative marks: MCQ 1/3 or 2/3 of marks; MSQ and NAT 0. (Older 2017 text says -0.33/-0.66.)
- Answers: MCQ letter, MSQ `A;C;D`, NAT `lo to hi` (sometimes two ranges joined by `OR`), occasionally `MTA`, and in 2019-2021 occasionally `C OR D`.
- Options with figures (patterns, cubes, graphs) are images; text extraction gives zero options.
- Code, tables, matrices, recurrences, logic formulas: always mangled by text extraction (indentation lost, stacked fractions, sub/superscripts as separate rows).

## 2. Extraction approach and its limits

Four builders, chosen per paper (`kind`): `text`, `byjus17`, `layer20`, `scan19`, `box21`.

1. **Text papers**: PyMuPDF lines merged into visual rows by vertical overlap (this re-joins table cells such as `(A) | text`). Anchors are rows starting `Q.n`; header/footer rows are stripped by regex and used to clip the crop. Options come from an A-B-C-D marker sequence.
2. **When a crop image is saved** (`image` non-null): the question region contains a real figure (watermarks/logos/table frames are filtered by looking for repeated image sizes and repeated drawing rects), vector drawings, math (non-ASCII glyph, math font), sub/superscripts or stacked rows, code-like text, or any structural problem. Otherwise `image` is null and `text`/`options` are trusted. The crop spans pages when the question does and is whitespace-trimmed. `render_reasons` lists the triggers, `text_quality` is `clean` or `garbled-see-image`. In practice about 70-90 percent of modern questions get an image. **App rule: if `image` is present, show the image as the source of truth and use `text` for search/AI only.**
3. **Image-only papers (2017, 2019, 2020, 2021)**: question boundaries come from the text-layer headers (2017, 2020), OCR of the left label strip plus full-page OCR with sequence repair (2019), or from detecting each bordered table by its continuous left border plus OCR of the label cell for continuation detection (2021). Every question gets a crop; `text` is Apple Vision OCR of the crop (`text_quality: ocr-see-image`, options left empty because OCR option splitting is unreliable). OCR is good on clean pages (2019, 2021), mediocre on math.
4. **Keys**: text keys parsed from word positions (rows grouped by y, wrapped cells re-attached). Image keys: OCR per column strip at several resolutions (Vision drops lone glyphs such as `A` in whole-page OCR) aligned on the Q.No. column; 2020's screenshot key is cut into cells using the ruled lines and OCR'd per cell. Key pages of OCR'd keys are rendered to `img/<paper>-key-p<n>.png` and linked from each question as `key_images` so an agent can read them.

Known limits and problems found:
- **2020 key**: single-letter MCQ answers are unreadable by OCR (low-res screenshot). 31 of 65 answers are null and flagged; NAT answers and `MTA` parsed. Fix in stage 2 by reading `img/2020-CS-key-p1/p2.png` visually.
- 2019 key: 6 answers null (OCR missed a cell, or the `C OR D` form); 2021 CS1: 2 null, CS2: 5 null (same causes). All flagged `needs_review`.
- Type of question in 2017-2020 comes from the key's format/column; MSQ does not exist there. For 2021 it comes from the Type column.
- Options are empty for image-only papers and for figure options in text papers (flagged `0 options parsed`, image present). 8 such questions in text papers.
- Text-paper `text`/`options` for math questions are best effort only (e.g. `14 2 7%` for 14 2/7 %). Never use them without the image.
- Sub-question text that precedes a figure sits in the crop; the section banners ("Q.6 - Q.10 carry two marks") are cut off by design.
- 2019 and 2020 GA/CS numbering restarts; `q_no` is normalised to continuous 1-65 and the printed number is kept in `qno_in_paper`.
- DA 2024 sample: no key, types inferred (MCQ vs NAT only; MSQ cannot be distinguished), so all 55 are `needs_review`.
- 2024-DA Q59 key is `MTA` (marks to all); stored as `answer: "MTA"`, `answer_mode: "mta"`.
- Crops can contain a sliver of the next table's frame (2023) or the section banner (rare). Cosmetic.
- OCR needs macOS. Re-running on another OS requires `--no-ocr` (image-only papers then have empty text and no key).

Per-paper result of the first full run (needs_review counts are structural problems, not text quality):

| Paper | Qs | with answer | crop images | needs_review | q types MCQ/MSQ/NAT |
|---|---|---|---|---|---|
| 2017-CS1 | 65 | 65 | 65 | 0 | 45/0/20 |
| 2017-CS2 | 65 | 65 | 65 | 0 | 45/0/20 |
| 2018-CS | 65 | 65 | 42 | 0 | 41/0/24 |
| 2019-CS | 65 | 59 | 65 | 6 | 42/0/23 |
| 2020-CS | 65 | 34 | 65 | 31 | 42/0/23 |
| 2021-CS1 | 65 | 63 | 65 | 2 | 34/13/18 |
| 2021-CS2 | 65 | 60 | 65 | 5 | 34/13/18 |
| 2022-CS | 65 | 65 | 45 | 1 | 32/15/18 |
| 2023-CS | 65 | 65 | 59 | 0 | 34/15/16 |
| 2024-CS1 | 65 | 65 | 45 | 0 | 29/20/16 |
| 2024-CS2 | 65 | 65 | 42 | 0 | 32/18/15 |
| 2025-CS1 | 65 | 65 | 56 | 1 | 30/13/22 |
| 2025-CS2 | 65 | 65 | 46 | 1 | 32/18/15 |
| 2026-CS1 | 65 | 65 | 46 | 1 | 28/24/13 |
| 2026-CS2 | 65 | 65 | 55 | 0 | 35/11/19 |
| 2024-DA | 65 | 65 | 54 | 3 | 37/12/16 |
| 2024-DA-sample | 55 | 0 | 55 | 55 | 44/0/11 |
| 2025-DA | 65 | 65 | 58 | 0 | 35/18/12 |
| 2026-DA | 65 | 65 | 57 | 0 | 33/14/18 |
| **Total** | **1225** | **1126** | | **106** | |

Machine-readable copy: `app/data/questions/_summary.json` (also lists review reasons and notes per paper).

## 3. JSON schema (`app/data/questions/<paper-id>.json`, a list)

```
id               "2024-CS1-q17"         paper-id + "-q" + q_no (unique)
exam_year        2024
paper            "CS" | "DA"
session          "CS1" | "CS2" | "CS" | "DA" | "DA-sample"   (the set/shift label; key's numeric session in key_session)
q_no             17                     continuous 1-65 (GA 1-10, subject 11-65); 2017 keys GA at 56-65
section          "GA" | "subject"
q_type           "MCQ" | "MSQ" | "NAT"
marks            1 | 2
negative_marks   0.3333 | 0.6667 | 0    (MCQ marks/3, others 0)
text             stem (or OCR text for image-only papers; see text_quality)
options          ["...", x4] or []      empty for NAT, figure options, and image-only papers
answer           "B" | ["A","C"] | {"ranges":[[lo,hi],...]} | "MTA" | null
answer_mode      "single" | "any_of" (list on MCQ: either accepted) | "all_of" (MSQ) | "range" | "mta" | null
answer_source    "official-key" | null
image            "img/<paper-id>-q<n>.png" (relative to app/data) or null
needs_review     bool                   true if review_reasons is non-empty
review_reasons   [string]
text_quality     "clean" | "garbled-see-image" | "ocr-see-image"
render_reasons   [figure|drawing/table|math|sub/superscript|code]   (text papers only)
source_pdf, source_pages (1-based), key_session, qno_in_paper (2019-2021), key_images (OCR'd keys), sample_paper
```

Stage 2 adds, per question (in place or in a sibling `app/data/enriched/<paper-id>.json` keyed by `id`; prefer the sibling file so re-extraction never clobbers agent work):
`topic_ids[]`, `difficulty` (1-5), `quick_solve[]`, `concept`, `traps[]`, `answer_verified` (bool), `answer_verified_by` ("key" | "agent-solve" | "agent+human"), `corrected_answer` (only if verification disagrees), `solution` (full worked solution), `tags` (free), `agent_notes`.

## 4. Stage 2: enrichment by AI agents (one agent per paper batch)

Inputs per question: `image` when present (else `text`+`options`), `answer`, `marks`, `q_type`. Agents must look at the image, never trust `text` for math/code questions.

Tasks per question:
1. **Topic tagging** against a topic tree (to be written as `app/spec/04-topic-tree.md`/`app/data/topics.json` first; ids like `cs.os.scheduling`, `cs.toc.regular-languages`, `cs.dbms.normalization`, `cs.ga.verbal`, `da.prob.bayes`, `da.ml.regression`, `da.dbms-warehousing.*`). One primary topic, up to two secondary. Closed vocabulary: agent returns an id from the tree or `UNMAPPED:<proposal>`; the tree owner reviews proposals weekly.
2. **Difficulty 1-5**: rubric 1 = single-fact recall, 2 = one-step application, 3 = multi-step standard (typical 2 marker), 4 = multi-concept or error-prone, 5 = rare trick / long computation. Anchor with the historical marks and the share of 2-mark questions.
3. **Quick way to solve**: 2-5 steps, include the shortcut (elimination, substitution of small n, dimension check, known formula) and the time budget in seconds.
4. **Concept explanation**: 3-6 sentences on the underlying idea, linked to the topic id.
5. **Trap notes**: the specific distractor logic (why wrong options are tempting, e.g. off-by-one, MSQ partial credit, NAT rounding range).
6. **Answer verification** (mandatory for every `answer` that is null, every `needs_review` answer reason, and a 100 percent re-solve of the 2017/2019/2020 papers, whose keys are the least reliable; at least a spot-check sample of 15 percent elsewhere). The agent solves the question independently first (without seeing the key), then compares. Mismatch: store `answer_verified=false`, `corrected_answer`, and escalate for a human check against the official PDF. For 2020 the 31 missing MCQ letters are read from `img/2020-CS-key-p1.png`, `-p2.png`, then re-solved. For the DA sample (no official key) the agent answer is the only answer and is marked `answer_verified_by: "agent-solve"`; flag low-confidence ones.
7. **Fix extraction**: for questions with `needs_review` caused by options/type/numbering, the agent writes the corrected `options`/`q_type` into the enriched file (original JSON stays untouched).

Volume: papers 19 (CS 15 incl. 2 sessions in 2017 and 2021 and 2018-2020, DA 4). 1225 questions; about 1170 need full enrichment (the DA sample can be treated as optional practice). That is about 65 questions per paper.

Batch size: 1 agent = 1 paper half (about 30 questions: GA 10 + 20 subject, or 33 questions) is the safe unit because each question needs an image look and a solve. Suggested split: agent A = GA (10) + subject Q11-35 (1 mark, 35 q), agent B = subject Q36-65 (2 marks, 30 q, harder, more solving). 38 agent runs for the 19 papers. Cheaper variant: 1 agent per full paper (65 q) with a smaller model for tagging and a stronger model for verification. Always run verification as a separate pass by a different agent than the one that wrote the solution.

## 5. Stage 3: original practice questions

Goal: depth for every topic in the tree, ordered easy to hard, with answer, explanation and QA.

1. **Demand model**: count tagged PYQs per topic and weight by marks (from stage 2). Target 8-12 questions for a frequent topic, 4-6 for a rare one. Estimated 120-160 topic leaves x about 6 = 750-1000 questions; with 5 difficulty levels spread 1-2 per level.
2. **Generation** (one agent per 2-4 topics): input = the topic's concept notes and 3-5 tagged PYQs as style exemplars (with difficulty). Output per question: `id` (`gen.<topic>.<nn>`), `topic_id`, `difficulty`, `q_type` (mix of MCQ/MSQ/NAT matching exam proportions for that topic), `marks`, stem, options, answer, short explanation, quick-solve, trap note, `derived_from` (PYQ ids, for style only). Must be original: do not copy PYQ numbers/text; change structure, not only constants. Use plain text plus LaTeX for math so no image is needed; generate figures only as small SVG when essential.
3. **Order** easy-to-hard inside each topic: difficulty ascending, then single concept before mixed.
4. **QA** (a separate agent, blind): solves each question from the stem only; passes when its answer equals the generator's answer and the explanation is consistent. Also checks: exactly one correct option for MCQ, MSQ options unambiguous, NAT has a tolerance and unit, difficulty plausible (QA agent proposes its own 1-5; accept if within 1), no near-duplicate of an existing PYQ (embedding or n-gram similarity), topic id valid. Numeric answers should be verified by running code (Python) wherever possible. Failures return to the generator once; two failures drop the question.
5. **Human spot-check**: 10 percent random sample plus every difficulty-5 question, in the app's review queue, before they go into the live bank. Mark generated questions `source: "generated"` so the app never presents them as past papers.

## 6. Order of work

1. Write the topic tree (needed by stage 2 and 3).
2. Stage 2 pilot on 2024-CS1 and 2025-DA (clean text, keyed) to tune prompts and measure verification disagreement rate.
3. Stage 2 on remaining keyed papers, then the keyless/weak-key papers (2017, 2019, 2020, 2021, DA sample) with 100 percent re-solve.
4. Stage 3 generation per topic using stage 2 output.
