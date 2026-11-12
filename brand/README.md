# GATE 27 — round 2

**Chosen: option A.** Its large orange 27 keeps the part the owner liked from round 1, while the closely set, plain GATE wordmark reads clearly at 64 px. Removing the small stair and star keeps the 27 recognizable at favicon size. Option B adds an orange depth edge to GATE; option C uses a smaller wordmark and underline. Both add detail without improving the small-size read.

## Files

- `options/option-a.svg`, `option-b.svg`, `option-c.svg`: three stacked lockups. `options-sheet.png` shows each on white and black; `options/sheet.svg` is its source.
- `logo-light.svg`, `logo-dark.svg`: chosen transparent lockup, with black or white GATE lettering.
- `icon.svg`, `icon-dark.svg`: rounded-square app icons with white or black backgrounds.
- `icon-maskable.svg`: full-bleed white background. The artwork fits within the central 80% diameter safe circle.
- `mark-27.svg`: the simplified orange 27 for tiny uses.
- PNG exports: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon-180.png`, `favicon-32.png`.

GATE is drawn with SVG paths. The logos use no font files, gradients, or raster artwork. Colors are `#0A0A0A`, `#FFFFFF`, `#FF7A00`, and the orange underside `#CC5F00`.

## Size check

The stacked app icon was visually checked at **64 × 64 px**: GATE remains readable. The **32 × 32 px** favicon uses only `mark-27.svg`. Use that standalone mark whenever the full lockup is too small to read.

## Rendering

`render.swift` in this directory renders the SVG exports on macOS. For example:

```sh
swift render.swift icon.svg icon-512.png 512
swift render.swift mark-27.svg favicon-32.png 32
swift render.swift options/sheet.svg options-sheet.png 1536 1024
```
