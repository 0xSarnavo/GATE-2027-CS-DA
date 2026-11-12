# Explainer v2: teach like a tutor

**Why v1 failed:** the 12-words-per-bullet Focus rule turned concepts into cryptic one-liners, such as "One table, each cell built from earlier cells." "Why you need it" was only a list of past-paper years. There was no intuition and no worked example with real numbers. The owner said: "concepts are not explained properly".

## v2 card structure, per concept (in this order)
1. **`idea`: the big idea in plain words.** 2–4 short sentences a returning student can follow with zero prior memory. Start from a concrete situation or analogy, then name the concept. No jargon before it is explained.
2. **`definition`:** the precise statement. One formula or rule, with every symbol explained in words right below it.
3. **`example`: a worked example with real numbers** (mandatory). A small, specific instance solved step by step: 3–7 numbered steps, each showing the actual computation (for example "dp[3] = dp[2] + dp[1] = 2 + 1 = 3"). It ends with the answer, and links to the animation scene when there is one (the scene should animate this exact example).
4. **`why`: why it matters.** 1–2 sentences on what problem it solves or what goes wrong without it, plus "In GATE:" with one line on how it is usually asked. Years go in a small `asked` footnote field, not here.
5. **`how`: the exam recipe.** 3–5 numbered steps for solving GATE questions on this concept.
6. **`mistake`: the common mistake.** What people do wrong, why it is wrong, and the correct move. 2–3 sentences.
7. **`check`: check yourself.** One quick question (`q`) with a short answer (`a`, shown on tap), solvable in under a minute.
8. **`asked`:** a small footnote listing the past-paper years and ids from the blueprint, for example "Asked: 2024 CS2 Q35, 2014 CS2 Q37".
9. **`try`:** the first L1/L2 ladder question, unchanged.

## Focus vs Full (ADHD-friendly without being cryptic)
- **Focus (default view)** shows: `idea`, `example` and `check`, collapsed to their short forms (`idea` ≤ 4 sentences; `example` ≤ 5 steps; one `mistake` line).
- **Full** adds: `definition` details, the longer example, `why`, `how`, the full `mistake` and the `_full` variants where given.
- **Readability rules:**
  - Short sentences (aim for 20 words or fewer).
  - One idea per sentence and one bold anchor per paragraph.
  - Plenty of white space. Prefer numbered steps to walls of text.
- **Banned:**
  - fragments that need prior knowledge to decode;
  - lists of years standing in for an explanation;
  - undefined symbols.

## Chapter note (`summary_md`) v2
Open with "**What this chapter is about**" (3–4 plain sentences), then a "**Concept map**" (the concepts in learning order, one line each). Then "**How GATE tests it**", the top 3 patterns in plain words, and the marks/paper figure from weightage.

## Data shape
`cards[]`: `{atom_id, title, idea, definition, example: {setup, steps[], answer}, why, how[], mistake, check: {q, a}, asked, try, scene, idea_full?, example_full?}`. The renderer must still accept v1 fields (`what`/`why`/`how`/`trap`), so old files keep working during the migration.

## v2.1: "more detail" (owner's choice after seeing the pilot)
Keep the v2 structure and add depth. All extra depth lives in Full, so Focus stays calm.
- **`intuition_full`:** a deeper "why this works" in 4–8 sentences. Give the mental model, plus a second analogy or a picture to imagine. Connect to the formula: why each term is there.
- **`examples`: an array of 2–3 worked examples** (it replaces the single `example`, which is kept as `examples[0]` for compatibility):
  1. **Basic:** the simplest case, with numbers and every step shown.
  2. **GATE-level:** an instance shaped like a real past-paper pattern for this concept, at 2-mark difficulty, step by step, ending with the trap avoided.
  3. **Optional twist:** an edge case where the naive approach fails, solved correctly.

  Each is `{level: basic|gate|twist, setup, steps[], answer}`. Verify every number by script.
- **`edge_cases`:** 2–4 bullets of special cases, each with a one-line consequence, for example "empty string → LCS 0" or "c > a → that coin is skipped".
- **`connections`:** 1–3 lines on related concepts and chapters ("Bellman-Ford is DP over edges", "LCS ↔ edit distance").
- **`check`: becomes an array of 2–3 quick questions,** easy to medium, each with an answer revealed on tap.
- **Focus view still shows only:** `idea`, `examples[0]`, `check[0]`. "Go deeper" reveals everything else in this order: definition, intuition_full, examples[1..], why, how, mistake, edge_cases, connections, the rest of check, asked.

## v2.2: "Explain like I'm 15" (owner request)
- **New field `simple` on every card:** an explanation a 15-year-old would follow.
  - Everyday language and short sentences, with no jargon. If a technical word is unavoidable, explain it in brackets the first time.
  - One vivid everyday analogy (cricket, cooking, school, phones, queues at a shop…).
  - 4–7 sentences, then one line: "In exam words: …", which maps the simple picture back to the proper term.
  - Use the `eli5` skill with the audience set to a 15-year-old.
- **New field `chapter_note.simple`:** the whole chapter explained the same way, in 4–6 sentences.
- **Reader:** an **"Explain simply"** toggle sits at the top of each concept. It is remembered per user, defaults OFF, and when ON shows `simple` *before* the big idea. A small **"Simpler"** link under the big idea opens it just once.
- `simple` must still be **correct**. A simplification may drop detail but must never say something false.
