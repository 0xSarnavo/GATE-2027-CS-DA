---
name: adhd-explain
description: Write study explanations in two layers, a short ADHD-friendly "Focus" layer and a "Full" detailed layer, for the GATE prep app. Use when writing or reviewing concept notes, explainer cards, hints, solutions, quick methods or flashcards; or when the user says "adhd", "focus mode", "too much text", "make it digestible", or "short and full version".
---

# ADHD-friendly explanations, in two layers

> **v2 correction (2026-10-07, owner feedback: "concepts are not explained properly").** Short must never mean cryptic. Every concept needs plain-language intuition AND a worked example with real numbers, even in the Focus layer. The hard 12-words-per-bullet cap is removed: aim for short sentences of 20 words or fewer instead. For concept explainers, follow `app/spec/12-explainer-v2-tutor.md`. Years of past papers are a footnote, never the explanation. Undefined symbols and fragments that only make sense if you already know the topic are banned.

The reader wants full understanding but gets overwhelmed by walls of text. So every explanation comes in two layers. The **Focus** layer is always shown. The **Full** layer opens on tap, and it always exists.

## Focus layer (default view)
- **One idea per chunk.** Short sentences (about 20 words or fewer), with complete thoughts that make sense to someone who has forgotten the topic.
- **Lead with the payoff.** The first line says what you can *do* with this idea, not its history.
- **Bold one anchor word per bullet**, the word to remember.
- **Concrete first, abstract second:** a tiny example with numbers, then the rule.
- **One formula at most**, written on its own line.
- **Visual hook:** point to the animation step or a simple ASCII table when it helps.
- **No preambles** ("In this section…", "It is important to note…"), no filler, no hype, no emoji.
- **End with one action:** "Try Q1", "Remember: …", "Next: …".

## Full layer (tap "Full")
- Full reasoning step by step, numbered, each step one sentence with its own *why*.
- Edge cases, the derivation where it builds intuition, and links to related topics.
- Worked example with every arithmetic step shown.
- Still plain and direct: short paragraphs (2–3 sentences) and headings every 4–6 lines.

## Shape for each content type
| Content | Focus | Full |
|---|---|---|
| Concept card: what it is | 1 line + formula | definition, intuition, tiny derivation |
| Why you need it | 1 line: GATE pattern + what it unlocks | years, frequency, links to later topics |
| How to solve | 3–4 steps, max 8 words each | each step with reason + mini-example |
| Hint | 1 nudge sentence | (none — hints stay short) |
| Solution | the 3-line path to the answer | complete working |
| Trap | "Don't X — do Y." | why people fall for it + example |

## Data fields
Write both layers into the content JSON as `<field>` (Focus, Markdown) and `<field>_full` (Full, Markdown). Examples: `what` / `what_full`, `solution` / `solution_full`, `summary_md` / `summary_full_md`. The app shows Focus by default and has a global "Focus ⇄ Full" toggle plus a per-card "Show more".

## Self-check before saving
- Can someone read the Focus layer in under 20 seconds per card?
- Is anything in Focus that isn't needed to solve? Move it to Full.
- Does Full cover everything needed for *complete* understanding? If not, add it.
- Read it aloud: if a sentence needs a breath in the middle, split it.
