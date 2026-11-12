# Brief for explainer-writing agents

Do the work yourself; don't fork or spawn subagents. Write each topic's file as soon as it is done.

1. **Read first:**
   - `app/spec/05-explainers.md`, `app/web/src/anim/scene.schema.json`, `app/web/src/anim/explainer.schema.json` and `app/web/src/anim/types.ts`
   - the samples in `app/data/explainers/_samples/`
   - two finished explainers for the quality bar: `app/data/explainers/prob.bayes.json` and `app/data/explainers/ds.c.json`
2. **Load skills.** Invoke the Skill tool with `adhd-explain`, then `no-ai-slop`, and follow both strictly.
   - **Focus fields** (`what`, `why`, `how[]`, `trap`): at most 3 bullets or steps, at most 12 words each, exactly one meaningful bold word per bullet, no bold math, no em dashes.
   - **Full fields** (`what_full`, `why_full`, `how_full[]`, `trap_full`): complete and plain.
3. **Cards.** For each topic, read `app/data/ladders/<topic_id>.json`. Its blueprint drives the cards:
   - one card per atom (merge tiny atoms);
   - `why` cites real GATE patterns and years from the blueprint, plus what the topic unlocks later;
   - `try` is `{id, label}` for the first L1/L2 ladder question that uses the atom.
4. **Scenes.** Write 2–4 per topic wherever motion teaches the idea.
   - Each caption says what to notice, and every motion shows a change of state.
   - Keep the viewBox around 360×240 and legible on a phone.
   - Engine semantics: ops within a step apply in the order set, swap, pop, push. `dim` works on any object, and `set` deep-copies.
5. **Output.** Write `app/data/explainers/<topic_id>.json` as `{topic_id, title, cards, scenes}`.
6. **Validate.** Run a bun script from `app/web` that imports `validateScene` from `src/anim/validate.ts` (see `/private/tmp/claude-501/-Users-sarnavo-Development-GATE-2027-CS-DA/5c2ecc77-429b-4796-8d63-b24d42c42d44/scratchpad/val_expl.ts`). It must report zero errors.
7. **Check visually.** Look at at least one scene per topic using a scratch vite preview. Copy the approach in `.../scratchpad/explain-code/prev/` (its `vite.config.mjs` aliases `src/anim` and the data folder) and use your own port. Never edit `src/anim/` or `_samples/`.
   - Use Claude in Chrome tools, loaded through ToolSearch in ONE call: `mcp__claude-in-chrome__tabs_context_mcp`, `tabs_create_mcp`, `navigate`, `computer`, `resize_window`, `read_console_messages`, `tabs_close_mcp`.
   - Fix anything clipped or overlapping. Close your tab and kill vite at the end.
8. **Stay in scope.** Edit nothing except your own explainer files. Use your own scratch subfolder.

Return the cards and scenes counts per topic, and say which scenes you checked visually.
