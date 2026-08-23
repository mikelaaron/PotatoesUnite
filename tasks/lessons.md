# Lessons

Patterns worth not repeating. Added after corrections.

## A brown ellipse with two eyes is an egg

**2026-08-22.** First pass at the potato body: a smooth brown oval, two dark
eyes, low-amplitude sinusoidal bumps. The owner's verdict on the device: it
reads as an egg. What makes a potato a potato is not the outline but the
things the outline alone cannot carry — a fat end, a darker underside, a
highlight that says it is a solid, and the dimples (a potato's real eyes)
scattered asymmetrically. The reference mock (`assets/potato-look-v1.svg`)
had all of those; the first implementation had none.

**How to apply:** when rendering a recognisable object procedurally, list what
makes it *that* object rather than its nearest primitive, and build those in
from the start. Fit the parameters from the art direction (here, a Fourier
fit of the mock's outline) instead of guessing.

## Per-pixel shading is a 3x frame cost; make it per-row

**2026-08-22.** Adding the underside shade and highlight as a per-pixel
ellipse test took the raster from 3.7 ms to 15.5 ms and the frame rate from
60 to 35. The creature's rule — shapes are scanline-analytic, no per-pixel
sqrt/atan2 — applies to shading too: a rotated ellipse is one quadratic per
row, and inside the body a row is a handful of constant-colour runs with
coverage-blended boundary pixels. Same picture, 4.9 ms.

**How to apply:** anything evaluated per pixel inside a ~40k-pixel body is a
frame-budget decision. Ask first whether it is a function of the row.

## Arduino_GFX fonts cannot draw straight to the CO5300

Text through `gfx->print` goes pixel by pixel (odd 1x1 windows) and would
shear the panel. The text band is an `Arduino_Canvas` in PSRAM, drawn with
the GFX font engine and flushed as one even-aligned blit, only when the text
changes (about 20 ms per flush, a few times an hour).

## Silence is the default; every reaction is rationed

**2026-08-22.** First real handling session: every lift produced a line and the
File filed seven entries in thirty seconds, including "Restored from the dark.
1s." Mike's verdict: too many quips, too often. The detectors were right; the
*policy* was missing. A sensor event is not a speaking opportunity.

**How to apply:** model handling as sessions with one line at the start, give
minor lines a shared budget with a random skip, let only major events bypass
it, and debounce physical states (dark, power) before they count. The File
records sessions, not movements. Rules are in `docs/POTATO_VOICE.md` §15.
