# GATE 27 logo and app icons

**Chosen: concept 2.** The bold “27” identifies the exam year immediately. The seven becomes a short three-level path to a goal star, connecting the mark to study progress. It remained the clearest of the three concepts at 32 px.

## Files

- `concepts/concept-1.svg`: gate with three rising steps and the year inside.
- `concepts/concept-2.svg`: chosen 27 path monogram.
- `concepts/concept-3.svg`: winding path leading to a gate badge.
- `mark.svg`: transparent square mark; works on white and true black.
- `logo.svg` / `logo-light.svg`: horizontal lockup for light surfaces.
- `logo-dark.svg`: horizontal lockup with white lettering for black surfaces.
- `icon.svg`: white full-bleed standard app icon.
- `icon-maskable.svg`: dark full-bleed icon; artwork stays inside the central 80% safe zone.
- PNG exports: `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`, `apple-touch-icon-180.png`, and `favicon-32.png`.

The wordmark is drawn with SVG paths. The SVGs use no fonts, gradients, or raster images.

## Colours and size

| Use | Colour |
| --- | --- |
| Base black | `#0A0A0A` |
| Base white | `#FFFFFF` |
| Accent orange | `#FF7A00` |
| Orange bottom edge | `#CC5F00` |

Use the square mark at **32 × 32 px or larger**. Use the horizontal lockup at **220 px wide or larger**. Keep the mark’s clear space at least the width of the seven’s thick stroke (about 58/512 of the mark width). The transparent mark has been checked at 32 px on white and `#000000`; use the dark lockup on black.

## Regenerate PNGs on macOS

Run `render.swift` with a source SVG, output PNG, width, and optional height. For example:

```sh
swift render.swift icon.svg icon-512.png 512
swift render.swift icon-maskable.svg icon-maskable-512.png 512
swift render.swift mark.svg favicon-32.png 32
```
