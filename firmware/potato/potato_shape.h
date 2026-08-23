#pragma once

#include <stdint.h>

// A potato is an ellipse that has been through something. It lies down.
//
// The silhouette is the base ellipse (rx, ry) — landscape, about 1.4:1 — with
// one end made fatter (egg) and its radius perturbed by a few low-frequency
// sinusoidal lumps. The skin is a flat fill with a darker underside ellipse
// and a faint top-left highlight, both clipped to the body. The dimples are a
// potato's real eyes; the two face-eyes are simply the two largest of them.
// That is the whole face. No mouth.
//
// Everything a variety can change lives in this one struct, so a variety is
// a table entry (eventually from assets/varieties.json), not a drawing
// routine. Geometry is in fractions of rx / ry so breathing and slosh scale
// it for free. Reference: assets/potato-look-v1.svg.
//
// Lives in a header because the Arduino preprocessor injects generated
// prototypes above the .ino body — see spring.h.

#define RGB565(r, g, b) ((uint16_t)((((r) & 0xF8) << 8) | (((g) & 0xFC) << 3) | ((b) >> 3)))

static const int POTATO_LUMPS = 5;
static const int POTATO_DIMPLES = 4;

struct Dimple { float x, y, rx, ry, rot; };   // x,y,rx,ry fractions; rot radians

struct PotatoShape {
  float rx, ry;                   // resting semi-axes, pixels (x across, y down)
  float egg;                      // y-radius grows by this toward +x: one fat end
  float lumpAmp[POTATO_LUMPS];    // radial perturbation, fraction of the radius
  float lumpFreq[POTATO_LUMPS];   // lobes around the outline (small integers)
  float lumpPhase[POTATO_LUMPS];  // radians — which side is the lumpy side

  uint16_t skin;                  // fill
  uint16_t shade;                 // underside colour, blended at shadeAlpha
  uint8_t shadeAlpha;             // 0..32
  float shadeX, shadeY, shadeRX, shadeRY;   // underside ellipse, fractions
  uint8_t highlightAlpha;         // white, 0..32
  float hiX, hiY, hiRX, hiRY;     // highlight ellipse, fractions

  uint16_t dimple;                // small dark ovals
  Dimple dimples[POTATO_DIMPLES];

  uint16_t ink;                   // the two face-eyes
  float eyeX[2], eyeY[2];         // fractions
  float eyeRX[2], eyeRY[2];       // fractions; slightly unequal on purpose
};

// Russet: brown, long oval, stubborn. Lumps fitted from the mock's outline
// (k=2, 3, 4 Fourier terms of its radius) with the k=3 term raised so the
// asymmetry is visible at 110px; the egg term gives the fat right end.
static const PotatoShape RUSSET = {
    .rx = 110.0f, .ry = 77.0f,
    .egg = 0.07f,
    .lumpAmp   = {0.0245f, 0.012f, 0.0141f, 0.0019f, 0.0f},
    .lumpFreq  = {2.0f, 3.0f, 4.0f, 5.0f, 6.0f},
    .lumpPhase = {0.074f, 1.913f, -2.429f, -1.406f, 0.0f},

    .skin = RGB565(0xA8, 0x74, 0x3F),
    .shade = RGB565(0x5E, 0x3A, 0x1C),
    .shadeAlpha = 12,                               // 0.38
    .shadeX = 0.216f, .shadeY = 0.61f, .shadeRX = 1.10f, .shadeRY = 0.86f,
    .highlightAlpha = 2,                            // 0.07
    .hiX = -0.41f, .hiY = -0.47f, .hiRX = 0.57f, .hiRY = 0.39f,

    .dimple = RGB565(0x6B, 0x42, 0x22),
    .dimples = {
        {0.61f, 0.31f, 0.049f, 0.029f, -0.436f},
        {-0.61f, 0.48f, 0.039f, 0.025f, 0.262f},
        {0.29f, 0.73f, 0.039f, 0.025f, 0.0f},
        {-0.69f, -0.28f, 0.034f, 0.020f, -0.524f},
    },

    .ink = RGB565(0x1A, 0x12, 0x0C),
    .eyeX = {-0.275f, 0.216f},
    .eyeY = {-0.195f, -0.236f},
    .eyeRX = {0.069f, 0.069f},
    .eyeRY = {0.125f, 0.132f},
};

// What the face is doing. Set by the server's scene; defaults to neutral.
enum Expression : uint8_t {
  EXPR_NEUTRAL = 0,
  EXPR_WAITING,
  EXPR_AGGRIEVED,
  EXPR_PLEASED,
  EXPR_ASLEEP,
  EXPR_DORMANT,
  EXPR_SPROUTED,
};

// Expression is eye shape only. scaleX/scaleY multiply the eye radii, dy
// moves the eye down in fractions of ry, closed draws the sleeping arc, dim
// darkens the whole body (asleep: 55% of full).
// (Here and not in the .ino: it is used in a function signature.)
struct EyePose { float scaleX, scaleY, dy; bool closed; float dim; };

static inline EyePose eyePoseFor(Expression e) {
  switch (e) {
    case EXPR_WAITING:   return {1.08f, 1.08f, 0.00f, false, 1.00f};
    case EXPR_AGGRIEVED: return {1.14f, 0.35f, 0.04f, false, 1.00f};   // flat slits
    case EXPR_PLEASED:   return {1.00f, 0.70f, 0.00f, false, 1.00f};
    case EXPR_ASLEEP:
    case EXPR_DORMANT:   return {1.00f, 1.00f, 0.00f, true,  0.55f};
    default:             return {1.00f, 1.00f, 0.00f, false, 1.00f};
  }
}
