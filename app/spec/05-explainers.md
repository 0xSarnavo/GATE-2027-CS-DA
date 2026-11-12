# Concept explainers with animations

Each topic gets an **explainer**, read before the ladder. It is short point-wise cards plus step-through animations that show the idea moving, rather than describing it.

## Card structure (per concept atom)
1. **What it is**: 1–3 plain lines with one formula or definition.
2. **Why you need it**: where GATE asks it (pattern + years from the blueprint), and what it unlocks later (e.g. "Bayes → naive Bayes classifier in ML").
3. **How to solve**: numbered recipe, 3–6 steps, the one you'd use in the exam.
4. **Watch it**: animation scene id (optional), stepped with Next/Prev, auto-play optional.
5. **Trap**: one line.
6. **Try it**: the first L1/L2 ladder question that uses this atom.

## Animation engine (in-app, data-driven, no video files)
Animations are JSON scenes rendered by a small Preact SVG player (`web/src/anim/`), so agents can author hundreds of them as data. The player is offline-friendly, a few KB in size, and theme-aware.

```json
{
  "id": "prob.bayes.tree",
  "title": "Bayes as a probability tree",
  "viewBox": [0, 0, 360, 240],
  "objects": [
    {"id": "root", "kind": "node", "x": 30, "y": 120, "label": "Start"},
    {"id": "d", "kind": "node", "x": 150, "y": 60, "label": "Disease"},
    {"id": "e1", "kind": "edge", "from": "root", "to": "d", "label": "0.01"}
  ],
  "steps": [
    {"caption": "Start with the prior: 1% have the disease.", "show": ["root", "d", "e1"], "highlight": ["e1"]},
    {"caption": "Multiply along each branch…", "show": ["..."], "animate": [{"id": "e1", "prop": "draw"}]},
    {"caption": "Posterior = highlighted path ÷ all positive paths", "math": "$P(D|+)=\\frac{0.0095}{0.0095+0.0495}$"}
  ]
}
```

**Object kinds:**
- `node`, `edge`/`arrow`, `box`, `text`, `math` (KaTeX)
- `array` (cells with indices: sorting, stacks, hashing)
- `matrix`
- `grid` (K-maps, DP tables)
- `bar` (distributions)
- `axis` + `point` / `vector` / `curve` (linear algebra, calculus)
- `tree` (auto-layout from nested children)
- `pointer` (moving arrow for algorithms)

**Step operations:**
- `show`, `hide`, `highlight`, `move {id, x, y}`
- `set {id, label | value | cells}`
- `draw` (stroke reveal)
- `swap` (array cells)
- `push` / `pop` (stack, queue)
- `caption`, `math`

**Motion rules:**
- Each step is 300–600 ms with ease-out, and only the changed objects move.
- `prefers-reduced-motion` turns this into instant step changes.
- Never decorative: every motion shows a change in state the learner must notice.

## Files
`data/explainers/<topic_id>.json`: `{ topic_id, cards: [...], scenes: [...] }`. It is imported alongside the ladders, and the player has a gallery and dev preview at `#/dev/anim`.

## Writing rules
- Two layers per the `adhd-explain` skill: Focus (short, default) and `_full` (complete detail).
- Plain, direct, human. No filler ("let's dive in", "it's important to note"), no hype, no emoji. Run text through the `no-ai-slop` skill's checks.
- The user is a CS grad back after a one-year gap. Assume they forgot, not that they never knew.
