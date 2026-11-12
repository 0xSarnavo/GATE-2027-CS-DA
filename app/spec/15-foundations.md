# Foundations and prerequisites

The owner last did calculus about 7 years ago and calls it his weakest area. He wants a quick foundation before each topic: school-level basics rebuilt fast, so that GATE chapters make sense.

## 1. Foundation chapters (new topics, prefix `found.`; scope "foundation")
Each has the same format as other chapters: a v2.2 explainer (`simple` first, then tutor style, with every concept animated) plus a short ladder that is mostly L1–L3. Keep them quick: 4–7 concepts, about 45–90 minutes each.

**Calculus track** (the priority; do these first, in this order):
1. `found.algebra`: expanding/factoring, fractions and powers, solving linear and quadratic equations, inequalities, absolute value.
2. `found.functions`: what a function is, domain and range, graphs of x, x², x³, √x, 1/x and |x|, shifting and stretching graphs, composition, inverse.
3. `found.explog`: exponent rules; e; the log as the inverse of exp; log rules; graphs of eˣ and ln x; growth comparison.
4. `found.trig`: radians, sin/cos/tan on the unit circle, standard values, key identities, graphs.
5. `found.limits_intuition`: what "approaching" means with tables of values and graphs, left and right limits, 0/0 forms, the standard limits sin x/x and (1+1/n)ⁿ.
6. `found.derivatives`: the derivative as slope and rate; the power, product, quotient and chain rules; derivatives of eˣ, ln x, sin and cos; reading increasing or decreasing from the sign of f'.
7. `found.integrals`: the integral as area and as an anti-derivative; basic rules; substitution; integration by parts with simple cases; definite integrals and even/odd shortcuts.
8. `found.series`: sequences, arithmetic and geometric sums, Σ notation, convergence intuition.

**Other foundations** (shorter):
- `found.fractions_percent`: fractions, ratios and percentages, for GA and probability.
- `found.sets_logic`: sets, Venn diagrams, ∧ ∨ ¬ →, quantifiers.
- `found.counting_basics`: factorials and nCr by intuition.
- `found.vectors_matrices`: vectors, the dot product, matrix multiplication by hand, the identity, the transpose.
- `found.programming_basics`: variables, loops, arrays and functions in C and Python, tracing code by hand.
- `found.binary`: number bases and binary arithmetic, for digital logic and COA.

## 2. Prerequisite map: `data/prereqs.json`
`{ "<chapter_id>": { "foundations": ["found.*"], "chapters": ["<earlier chapter ids>"] } }` for all 113 chapters.

For example:
- `calc.limits` → found.algebra, functions, explog, trig, limits_intuition
- `calc.maxmin` → found.derivatives + calc.limits
- `prob.continuous` → found.integrals
- `la.eigen` → found.vectors_matrices + la.matrices_det

Every chapter also gets a 4–6 question **readiness check** (`data/readiness/<chapter>.json`, short MCQ or NAT on its prerequisites only, with answers and the foundation each question tests).

## 3. App
- **Learn home** gets a **Foundations** section at the top, with the calculus track shown as a path.
- **Chapter page:** "Before you start: Readiness check (2 min)". If it reveals gaps, it says "Do these first", with links to the exact foundation concepts and the option to skip. A chip shows "Prerequisites: ✓ 3/5".
- **Concept reader:** a small "Need a refresher?" link opens the matching foundation concept in a sheet.
- **Plan:** a daily **"Foundation · 30 min"** block from tomorrow until 15 Nov: the calculus track first, then fractions, vectors/matrices and binary. After that, each week's chapters get their readiness check as the first task of the week.
