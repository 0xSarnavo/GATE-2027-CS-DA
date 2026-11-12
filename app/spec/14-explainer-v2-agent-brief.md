# Brief for v2.1 explainer-rewrite agents

Do the work yourself; don't fork or spawn subagents. Write each chapter's file as soon as it is done, since a cutoff should lose as little as possible.

1. **Read first:**
   - `app/spec/12-explainer-v2-tutor.md`, including the v2.1 section: the standard you must follow exactly.
   - `app/spec/05-explainers.md`
   - `app/web/src/anim/scene.schema.json` and `types.ts`
2. **Load skills:** `adhd-explain` (note its v2 correction), `no-ai-slop` and `eli5` (audience: a 15-year-old), for the v2.2 `simple` field.
3. **Use the pilot as the quality bar.** Study `app/data/explainers/algo.dp.json`, `prob.bayes.json` and `os.vm.json`. Your output must also include the v2.1 fields (`intuition_full`, `examples[]` with basic, gate and optional twist, `edge_cases`, `connections`, `check[]`) and the v2.2 fields (`simple` on every card, `chapter_note.simple`). Also redo the three pilot chapters to add these fields if they fall in your batch.
4. **Plan each chapter:** read `app/data/ladders/<topic>.json`. Use its blueprint atoms, patterns and traps, its ladder questions (for `try`) and the PYQ enrichment (for GATE-level example shapes).
   - Keep one card per concept, and split merged atoms if that is clearer.
   - Keep the existing scenes. Adjust or add a scene so card examples[0] is exactly what a scene animates.
   - Add `chapter_note`: `{about, concept_map, gate_patterns}`.
   - Example numbers must differ from the ladder questions, so `try` is not spoiled.
5. **Compatibility:** also set the v1 fields so old renderers still work:
   - `what` = idea
   - `what_full` = idea_full or idea + definition + examples[0] as text
   - `why` / `why_full`
   - `how` (array)
   - `trap` = mistake
6. **Verify every number** in every example and check answer with a Python script in your scratch folder. Validate the scenes with `validateScene` (a bun script run from `app/web`).
7. **Stay in scope.** Edit only your chapters' explainer files, and keep a backup of each original in your scratch folder.

Return card and scene counts per chapter, plus anything you were unsure of.

## Every concept gets its own animation (owner request, 2026-10-07)
Every card must have a `scene` that animates **its own `examples[0]`** step by step: the same numbers, one scene step per example step where possible, so the reader's step-sync works. Reuse an existing scene only if it shows exactly that example. Otherwise write a new one. Use the engine's object kinds (array, grid, matrix, tree, node/edge graphs, axis/vector/curve, bar, pointer, box/text/math) to make the change of state visible. Concepts that are purely definitional still get a short scene, for example a labelled diagram building up, a comparison table filling in, or a timeline. Validate every scene and look at least at the first and last step of each one in a preview.

**No template scenes.** A generic "worked steps" scene (a row of progress cells filling with numbers, or text steps on a blank stage) does NOT count. Each scene must draw the actual objects of the concept and show them changing, for example:
- the Venn regions shading;
- the tree branches multiplying;
- the array cells swapping;
- the graph nodes being visited;
- the bars growing;
- the folded paper and its punched holes;
- the seating slots being filled and eliminated.

If you can't picture it, sketch the textbook diagram for that example and animate how it builds up.

## Low-memory mode (the owner's laptop has 8 GB RAM, overrides earlier preview instructions)
- Do NOT start vite, a dev server, Chrome or any headless browser. The visual check is done centrally once per batch.
- Check scenes structurally instead with the `validateScene` bun script. Also run a quick geometry lint script that confirms every object's x/y (plus its width/height) lies inside the viewBox, and that no two text labels sit within 10px of each other at the same step.
- Keep scripts small. Don't load more than one chapter's JSON at a time, and don't keep large outputs in memory.
