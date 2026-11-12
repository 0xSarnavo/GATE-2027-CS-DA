# Topic ladders: analysed PYQs + teaching question sets

Goal: for each topic, the user goes from "never seen it" to "solves the hardest GATE variant", one small step at a time. Each step teaches something, and they practise *different* variants, not the same question re-skinned.

## Per-topic pipeline (one agent per 3–5 topics)
1. **Analyse.** Read every official PYQ tagged with the topic. The tags are in `data/tags/<paper>.json` and the questions in `data/questions/<paper>.json`. Use the question image when the text is garbled. Write the blueprint:
   - concept atoms (smallest ideas the topic needs)
   - question patterns GATE uses, with frequency and years
   - common traps
   - what the hardest PYQ demands
2. **Enrich the PYQs** of that topic: `quick_method`, `solution`, `explanation`, `trap_note`, `hints[]`, and `difficulty` if the tag was off. Re-solve each one. If your answer disagrees with the key, set `answer_check: "disagrees"` with a reason. Never overwrite the official answer.
3. **Build the ladder:** original questions, 20–35 per topic, ordered easy to hard:
   - **L1 Concept check:** definition or one-step recall (3–6 questions)
   - **L2 Single-step apply:** one formula or idea applied directly (4–7)
   - **L3 Two-step / combine:** two atoms together, typical 1-mark GATE (5–8)
   - **L4 GATE 2-mark:** multi-step, MSQ/NAT style, with distractors built from real traps (4–8)
   - **L5 Tricky / hardest:** variants of the hardest PYQ patterns, with edge cases and traps (3–6)

   Each atom in the blueprint must appear in at least one L1–L2 question before it is used in L3+. Mix MCQ, MSQ and NAT the way GATE does. Vary the surface (story, numbers, structure) so a question teaches a new angle rather than repeating one.
4. **Verify.** Solve every generated question independently a second time. For anything computable, check it with a short Python script. Drop or fix any question where the two solves disagree.

## Output files (one per topic)
`data/ladders/<topic_id>.json`:
```json
{
  "topic_id": "prob.bayes",
  "blueprint": {
    "atoms": [{"id":"a1","name":"...","one_line":"..."}],
    "patterns": [{"name":"...","years":["2024-DA-q30"],"freq":3,"note":"..."}],
    "traps": ["..."],
    "hardest_pyq": "2025-DA-q44",
    "summary_md": "half-page concept note in Markdown + KaTeX"
  },
  "pyq_enrichment": [
    {"id":"2024-DA-q30","difficulty":3,"quick_method":"md","solution":"md","explanation":"md",
     "trap_note":"md","hints":["md","md"],"answer_check":"agrees|disagrees|unsure","answer_check_note":""}
  ],
  "ladder": [
    {"id":"gen.prob.bayes.001","level":1,"order_in_topic":1,"atoms":["a1"],
     "type":"MCQ|MSQ|NAT","marks":1,"stem":"md + $katex$",
     "options":[{"key":"A","text":"..."}], "answer":"B | A,C | 0.25 | 0.24..0.26",
     "hints":["Step 1 nudge","Step 2 nudge","Step 3 almost-there"],
     "solution":"md, numbered steps","quick_method":"md shortcut","trap_note":"md",
     "explanation":"md: the concept this step teaches",
     "variant_of":"2024-DA-q30 (optional)","verified":true}
  ],
  "flashcards": [{"front":"md","back":"md","kind":"formula|definition|trap"}]
}
```

**Formatting rules**
- Markdown with KaTeX `$...$` / `$$...$$`.
- Answers follow the DB format: `B`, `A,C`, `12.5`, or a NAT range `lo..hi`.
- `hints` reveal one at a time in the app: three or four, each teaching rather than just giving the answer.
- Also write 8–15 flashcards per topic (formulas, definitions, traps).

**Validation:** each file must load as JSON, every `topic_id` must exist in `seed/topics.json`, ids must be unique, and every MCQ/MSQ answer key must be in its options.
