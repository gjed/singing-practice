# Usage

One page of rules for the gjed mark and lockup. The **UsageGuide** card shows each rule.

## Clear space

- Leave clear space of **¼ H** on every side of the mark, where H is the mark's height from crown to tail tip (`logo-clearspace`). That is the length of the tail below the perch.
- For the lockup, the clear space is the x-height of the wordmark's `e`.
- The horizon line is the one exception: it may continue from the perch to the edge of the canvas, at the perch's weight (`logo-perch-weight`).

## Minimum size

| Asset                                                 | Minimum                | Below that               |
| ----------------------------------------------------- | ---------------------- | ------------------------ |
| Faceted mark with gaps (`gjed-mark*.svg`)             | 24px tall              | switch to the small mark |
| Small mark (`gjed-mark-small.svg`, no gaps; favicons) | 16px tall              | don't use the mark       |
| Lockup (`gjed-lockup*.svg`)                           | 20px tall (≈96px wide) | use the mark alone       |
| Badges                                                | 20px                   | —                        |

## Versions on light and dark

- **Vellum or white ground:** `gjed-mark.svg` / `gjed-lockup.svg` (Plum + Orchid, Ink wordmark).
- **Ink or near-black ground (GitHub dark):** `gjed-mark-dark.svg` / `gjed-lockup-dark.svg` (Plum-mid + Orchid).
- **Sea ground:** `gjed-mark-sea.svg`: shifted one step lighter, Orchid shade and perch with Lilac #F1DDF7 light, as on the avatar.
- **One ink only:** `-mono.svg` (Plum), `-black.svg` on light, `-white.svg` on dark. The facet gaps are real holes, so the ground shows through.
- On any other colour or on photos, put the mark on a solid Vellum or Sea tile first.

## Don't

- Don't rotate, tilt, flip or stretch the mark. The bird always faces right, toward the wordmark.
- Don't swap which facets are light and shaded, and don't add a third tone.
- Don't add gradients, shadows, outlines, glows or textures.
- Don't recolour the facets outside Plum, Plum-mid, Orchid and Lilac (or one ink: Plum, black, white).
- Don't crop the tail or remove the perch. The perch is part of the mark.
- Don't place the mark on low-contrast or mid-purple grounds.
- Don't colour the wordmark purple, retype it in a live font, change its case, or set it next to the mark at a different alignment.
- Don't add wizard imagery, staffs, stars, runes or book-cover motifs around the mark, and don't give the bird a speech bubble, accessories or a face.
- Don't use the gapped mark below 24px, or the small mark above 32px.
