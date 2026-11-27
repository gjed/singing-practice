# Vocalizzi — export (2026-11-26)

| Path | What |
| --- | --- |
| `plan/vocal-exercises-site-plan.md` | The full plan: `.vex` format, engine, UX, languages and appearance, facets, collections, favourites, AWS accounts, design and themes, repo layout, CI/CD, library, roadmap |
| `design/artboards/*.dc.html` | Design canvas sources: Library, Player, Editor, Player on a phone (night), and the orange/red palette options |
| `design/canvas.json` | Canvas layout |
| `brand/` | gjed mark (light and dark) and logo-usage notes, for the "made by gjed" footer |
| `exercises/` | Four sample `.vex` files with facets, in the repo layout |
| `collections/` | A sample library collection (`daily-warm-up.yaml`) |

## Design direction

Songbooks site design unchanged in structure (typewriter fonts, paper sheet on a desk, 1.5px ink borders, radius 0, hard offset shadows, dark masthead band, square tiles), recoloured by a Theme dropdown with six palettes, each with light and dark variants, plus a Light / Dark / System control. The palettes and how themes are built are in the plan's Visual design section; `PaletteOptions.dc.html` shows the four orange/red ones side by side.

Personal touches: staff lines in the masthead band, melodic contours drawn on a staff as exercise covers, category accent colours, and gjed only in the footer.

The `.dc.html` files need the Claude Design canvas runtime to render; use them as a reference for markup and colour values.
