Design an original logo and app icon set for "GATE 27", a personal study app for the GATE 2027 exam (Computer Science + Data Science & AI papers). Work only inside this directory.

Style: playful, bold, friendly, like a modern learning app. Chunky rounded shapes, flat colours, a subtle 3D bottom edge (darker shade under the shape). Not generic, and not a gradient-blob "AI" look. No mascots or animals, and nothing resembling any existing brand (no owl, nothing like Duolingo's logo). Palette: black #0A0A0A and white #FFFFFF as the base, with a single accent orange #FF7A00 (3D shadow edge #CC5F00). Do not use other colours. The logo must work on white (light mode) and on true black #000000 (dark mode); provide a light and a dark variant if needed (logo-light.svg, logo-dark.svg).

Concept directions. Produce 3, then pick the best:
1. A gate or arch shape whose opening forms a rising path of 3 steps (levels), with "27" on or inside it.
2. A bold "27" monogram where the 7 doubles as a stair or path climbing to a small star or flag (goal).
3. A rounded-square badge with a winding path of dots leading to a gate.

Deliverables:
- `concepts/concept-1.svg`, `concept-2.svg`, `concept-3.svg`: clean hand-written SVG, viewBox 0 0 512 512, no embedded raster.
- `logo.svg`: the chosen mark as a horizontal lockup with the wordmark "GATE 27". For the wordmark, convert to paths or use a geometric drawn lettering. Do not depend on a font being installed.
- `mark.svg`: the square mark only.
- `icon-maskable.svg`: full-bleed background, with the mark inside the central 80% safe zone.
- PNGs rendered from those SVGs: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon-180.png` and `favicon-32.png`. Use any available renderer, such as rsvg-convert, Inkscape or a small Python script with cairosvg or Pillow; install into a local venv if needed.
- If you have an image-generation tool available, you may use it for exploration. The final deliverables must still be SVG and the PNGs rendered from them.
- `README.md`: which concept you chose and why, the colours used, and minimum sizes.

Check the mark is legible at 32px and on both white and #000000 backgrounds. Don't touch anything outside this directory.
