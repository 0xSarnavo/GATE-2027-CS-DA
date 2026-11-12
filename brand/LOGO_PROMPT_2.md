Round 2 of the "GATE 27" logo. Work only inside this directory. Round 1 is in `round1/`. Open `ref-27.svg` (round-1 concept 2: a bold orange "27" with a chunky 3D bottom edge). The owner liked the "27".

New direction from the owner: **the "27" on top, with "GATE" written below it**, as a stacked logo.
- Keep the bold, rounded, chunky orange "27" with the darker bottom edge (#FF7A00 / #CC5F00). Simplify it. Drop the tiny stair-and-star detail unless it stays crisp at 32px. If you keep a hint of "progress", make it bold and simple.
- Under it, the word **GATE**: a clean, heavy, geometric, rounded sans in black #0A0A0A on light backgrounds and white on dark. Draw the letters as SVG paths; don't use font files. Letter-spacing is slightly open. The width of "GATE" should match or be slightly narrower than the "27".
- Keep the gap between "27" and "GATE" tight, so they read as one mark.
- Colours: only black, white and orange. No gradients and no mascot.

Deliverables (SVG with viewBox 0 0 512 512 unless noted):
- `options/option-a.svg`, `option-b.svg` and `option-c.svg`: 3 variations of the stacked lockup. Vary the proportions of 27 vs GATE, a 3D edge on GATE or not, and an orange underline bar or not.
- After choosing the best one:
  - `logo-light.svg` and `logo-dark.svg`: stacked lockup, transparent background.
  - `icon.svg`: rounded-square app icon with a white background and the stacked mark centred.
  - `icon-dark.svg`: the same on black.
  - `icon-maskable.svg`: full-bleed, with the mark inside the central 80%.
  - `mark-27.svg`: only the 27, for tiny sizes such as the favicon.
- PNGs rendered from the SVGs (any renderer; there is a `render.swift` in round1/ you can reuse): `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon-180.png` and `favicon-32.png` (made from mark-27).
- `options-sheet.png`: all 3 options side by side on white and on black, for review.
- `README.md`: which option you chose and why.

Check legibility: GATE must be readable at 64px icon size. At 32px only the 27 is used.
