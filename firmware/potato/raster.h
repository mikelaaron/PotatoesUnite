#pragma once

#include <stdint.h>
#include <math.h>
#include <string.h>
#include "potato_shape.h"

// Rasterizer into one internal-DMA window buffer, blitted per dirty region.
//
// Load-bearing, from creature / 01_lean:
//   Blit rects must be even on all four edges. The CO5300 addresses columns in
//   pairs and Arduino_CO5300 passes the rect straight to CASET, so an odd edge
//   shears the panel into vertical streaks. The .ino prints ODD! if it recurs.
//
//   Shapes are scanline-analytic: an ellipse row is one quadratic solve, a
//   potato row is two sub-row interval lookups. No per-pixel sqrt or atan2.

// 192 keeps the DMA tile even-aligned while leaving enough internal RAM for
// a verified TLS handshake. At 272 the 148 KB tile left only ~27 KB free and
// mbedTLS failed before the public Net could answer.
static const int MAX_RECT = 192;   // 73728 bytes; a body frame is at most 2 tiles
static uint16_t *win = nullptr;
static int rcX = 0, rcY = 0, rcW = 0, rcH = 0;   // window geometry (buffer)
static int clX0 = 0, clY0 = 0, clX1 = -1, clY1 = -1;   // clip, inclusive

static inline void setWindow(int x, int y, int w, int h) {
  rcX = x; rcY = y; rcW = w; rcH = h;
  clX0 = x; clY0 = y; clX1 = x + w - 1; clY1 = y + h - 1;
}

static inline void setClip(int x0, int y0, int x1, int y1) {
  clX0 = x0 < rcX ? rcX : x0;
  clY0 = y0 < rcY ? rcY : y0;
  clX1 = x1 > rcX + rcW - 1 ? rcX + rcW - 1 : x1;
  clY1 = y1 > rcY + rcH - 1 ? rcY + rcH - 1 : y1;
}

static inline void resetClip() {
  clX0 = rcX; clY0 = rcY; clX1 = rcX + rcW - 1; clY1 = rcY + rcH - 1;
}

static inline uint16_t blend565(uint16_t d, uint16_t s, int a /* 0..32 */) {
  const int dr = (d >> 11) & 0x1F, dg = (d >> 5) & 0x3F, db = d & 0x1F;
  const int sr = (s >> 11) & 0x1F, sg = (s >> 5) & 0x3F, sb = s & 0x1F;
  const int r = (sr * a + dr * (32 - a)) >> 5;
  const int g = (sg * a + dg * (32 - a)) >> 5;
  const int b = (sb * a + db * (32 - a)) >> 5;
  return (uint16_t)((r << 11) | (g << 5) | b);
}

static inline uint16_t mixColor(uint16_t a, uint16_t b, float t) {
  if (t <= 0.0f) return a;
  if (t >= 1.0f) return b;
  return blend565(a, b, (int)(t * 32.0f + 0.5f));
}

static inline void ellipseExtent(float rx, float ry, float theta,
                                 float *ex, float *ey) {
  const float ct = cosf(theta), st = sinf(theta);
  *ex = sqrtf(rx * rx * ct * ct + ry * ry * st * st);
  *ey = sqrtf(rx * rx * st * st + ry * ry * ct * ct);
}

// Filled ellipse in screen coordinates, rotated by theta, anti-aliased rim.
//
// Substituting the rotated ellipse equation and collecting in dx gives
// A*dx^2 + B*dx + C = 0 per row, so the row's interior is the interval between
// the roots. The sub-pixel roots also give exact edge coverage for free.
static void ellipseRotAlpha(float cx, float cy, float rx, float ry,
                            float theta, uint16_t color, int alpha) {
  if (rx < 0.5f || ry < 0.5f) return;
  if (alpha < 1) return;
  if (alpha > 32) alpha = 32;

  const float ct = cosf(theta), st = sinf(theta);
  const float irx2 = 1.0f / (rx * rx), iry2 = 1.0f / (ry * ry);

  const float A = ct * ct * irx2 + st * st * iry2;
  const float bK = 2.0f * ct * st * (irx2 - iry2);
  const float cK = st * st * irx2 + ct * ct * iry2;
  const float inv2A = 0.5f / A;

  float ex, ey;
  ellipseExtent(rx, ry, theta, &ex, &ey);

  int y0 = (int)floorf(cy - ey), y1 = (int)ceilf(cy + ey);
  if (y0 < clY0) y0 = clY0;
  if (y1 > clY1) y1 = clY1;

  for (int y = y0; y <= y1; ++y) {
    const float dy = (float)y + 0.5f - cy;
    const float B = bK * dy;
    const float C = cK * dy * dy - 1.0f;
    const float disc = B * B - 4.0f * A * C;
    if (disc <= 0.0f) continue;

    const float sq = sqrtf(disc);
    const float xa = cx + (-B - sq) * inv2A;
    const float xb = cx + (-B + sq) * inv2A;

    // Index the row from its own start rather than offsetting a base pointer
    // by a screen coordinate; the latter transiently points before the buffer.
    uint16_t *row = win + (size_t)(y - rcY) * rcW;
    const int lo = clX0, hi = clX1;

    int iL = (int)ceilf(xa);
    int iR = (int)floorf(xb) - 1;

    const int pl = iL - 1;
    if (pl >= lo && pl <= hi) {
      const float cov = (float)iL - xa;
      if (cov > 0.004f) {
        uint16_t *p = row + (pl - rcX);
        *p = blend565(*p, color, (int)(cov * alpha + 0.5f));
      }
    }
    const int pr = iR + 1;
    if (pr >= lo && pr <= hi && pr != pl) {
      const float cov = xb - (float)pr;
      if (cov > 0.004f) {
        uint16_t *p = row + (pr - rcX);
        *p = blend565(*p, color, (int)(cov * alpha + 0.5f));
      }
    }

    if (iL < lo) iL = lo;
    if (iR > hi) iR = hi;
    if (alpha == 32) {
      for (int x = iL; x <= iR; ++x) row[x - rcX] = color;
    } else {
      for (int x = iL; x <= iR; ++x) {
        uint16_t *p = row + (x - rcX);
        *p = blend565(*p, color, alpha);
      }
    }
  }
}

static inline void ellipseRot(float cx, float cy, float rx, float ry,
                              float theta, uint16_t color) {
  ellipseRotAlpha(cx, cy, rx, ry, theta, color, 32);
}

// ------------------------------------------------------------------ potato ---

// The silhouette is sampled once per frame into a closed polygon in screen
// space. 128 samples on a ~100px radius is under 5px per edge, which the
// sub-pixel scanline fill below turns into a curve the eye cannot fault.
static const int OUTLINE_N = 128;
static float outX[OUTLINE_N], outY[OUTLINE_N];
static float outMinX, outMinY, outMaxX, outMaxY;

// Body-local (lx, ly) to screen. Matches ellipseRot's convention: body-down
// maps to (-r sin t, r cos t).
static inline void bodyToScreen(float cx, float cy, float ct, float st,
                                float lx, float ly, float *sx, float *sy) {
  *sx = cx + lx * ct - ly * st;
  *sy = cy + lx * st + ly * ct;
}

static void potatoOutline(const PotatoShape &s, float cx, float cy,
                          float sx, float sy, float theta) {
  const float ct = cosf(theta), st = sinf(theta);
  outMinX = outMinY = 1e9f;
  outMaxX = outMaxY = -1e9f;
  for (int i = 0; i < OUTLINE_N; ++i) {
    const float a = (float)i * (6.28318530718f / OUTLINE_N);
    const float ca = cosf(a), sa = sinf(a);
    float r = 1.0f;
    for (int k = 0; k < POTATO_LUMPS; ++k) {
      if (s.lumpAmp[k] == 0.0f) continue;
      r += s.lumpAmp[k] * sinf(s.lumpFreq[k] * a + s.lumpPhase[k]);
    }
    // The egg: the y-radius grows toward +x, so one end is fatter.
    const float lx = sx * r * ca, ly = sy * r * sa * (1.0f + s.egg * ca);
    bodyToScreen(cx, cy, ct, st, lx, ly, &outX[i], &outY[i]);
    if (outX[i] < outMinX) outMinX = outX[i];
    if (outX[i] > outMaxX) outMaxX = outX[i];
    if (outY[i] < outMinY) outMinY = outY[i];
    if (outY[i] > outMaxY) outMaxY = outY[i];
  }
}

// Fill the sampled outline. Each pixel row is split into two sub-rows; each
// sub-row's interior is the interval between the outline's two crossings
// (the bumps are small enough that the shape stays star-shaped about its
// centre, so there are exactly two). Interior pixels inside both sub-row
// intervals are written directly; pixels at the ends get coverage from the
// exact sub-pixel interval overlap, averaged over the two sub-rows. That
// anti-aliases the near-horizontal top and bottom as well as the sides.
static float subL[2 * MAX_RECT], subR[2 * MAX_RECT];

// The skin: flat fill, a darker underside ellipse and a faint top-left
// highlight. Both are rotated ellipses in screen space, so per row each is
// one quadratic solve giving an interval; inside the body row the pixels
// are then constant-colour runs between at most four boundary pixels, which
// get coverage-blended. Clipping to the silhouette is by construction. The
// (shade level, highlight level) palette is built once per frame, dimming
// included. No per-pixel evaluation anywhere.
static const int SHADE_LEVELS = 17, HI_LEVELS = 9;

struct EllipseRow { float cx, cy, A, bK, cK, inv2A, ey; };

static void ellipseRowSetup(EllipseRow &e, float cx, float cy, float rx, float ry,
                            float theta) {
  const float ct = cosf(theta), st = sinf(theta);
  const float irx2 = 1.0f / (rx * rx), iry2 = 1.0f / (ry * ry);
  e.cx = cx; e.cy = cy;
  e.A = ct * ct * irx2 + st * st * iry2;
  e.bK = 2.0f * ct * st * (irx2 - iry2);
  e.cK = st * st * irx2 + ct * ct * iry2;
  e.inv2A = 0.5f / e.A;
  float ex;
  ellipseExtent(rx, ry, theta, &ex, &e.ey);
}

static inline bool ellipseRowSpan(const EllipseRow &e, float yc, float *xa, float *xb) {
  const float dy = yc - e.cy;
  if (fabsf(dy) > e.ey) return false;
  const float B = e.bK * dy, C = e.cK * dy * dy - 1.0f;
  const float disc = B * B - 4.0f * e.A * C;
  if (disc <= 0.0f) return false;
  const float sq = sqrtf(disc);
  *xa = e.cx + (-B - sq) * e.inv2A;
  *xb = e.cx + (-B + sq) * e.inv2A;
  return true;
}

struct BodyPaint {
  EllipseRow shade, hi;
  uint8_t shadeA, hiA;            // levels in use (<= 16, <= 8)
  uint16_t table[SHADE_LEVELS][HI_LEVELS];
};

static void setupBodyPaint(BodyPaint &p, const PotatoShape &s, float cx, float cy,
                           float sx, float sy, float theta, float dim) {
  const float ct = cosf(theta), st = sinf(theta);
  float ex, ey;
  bodyToScreen(cx, cy, ct, st, s.shadeX * sx, s.shadeY * sy, &ex, &ey);
  ellipseRowSetup(p.shade, ex, ey, s.shadeRX * sx, s.shadeRY * sy, theta);
  bodyToScreen(cx, cy, ct, st, s.hiX * sx, s.hiY * sy, &ex, &ey);
  ellipseRowSetup(p.hi, ex, ey, s.hiRX * sx, s.hiRY * sy, theta);
  p.shadeA = s.shadeAlpha > 16 ? 16 : s.shadeAlpha;
  p.hiA = s.highlightAlpha > 8 ? 8 : s.highlightAlpha;
  for (int a = 0; a <= p.shadeA; ++a) {
    const uint16_t c = blend565(s.skin, s.shade, a);
    for (int b = 0; b <= p.hiA; ++b) {
      p.table[a][b] = mixColor(0x0000, blend565(c, 0xFFFF, b), dim);
    }
  }
}

static void potatoFill(const BodyPaint &paint) {
  const int nsub = 2 * rcH;
  for (int k = 0; k < nsub; ++k) { subL[k] = 1e9f; subR[k] = -1e9f; }

  for (int i = 0; i < OUTLINE_N; ++i) {
    float x0 = outX[i], y0 = outY[i];
    float x1 = outX[(i + 1) % OUTLINE_N], y1 = outY[(i + 1) % OUTLINE_N];
    if (y0 == y1) continue;
    if (y0 > y1) { float t = x0; x0 = x1; x1 = t; t = y0; y0 = y1; y1 = t; }
    // Sub-row k has its centre at rcY + (k + 0.5) * 0.5. Include centres in
    // [y0, y1) so each crossing is counted by exactly one of the two edges
    // that share a vertex.
    int k0 = (int)ceilf((y0 - rcY) * 2.0f - 0.5f);
    int k1 = (int)ceilf((y1 - rcY) * 2.0f - 0.5f) - 1;
    if (k0 < 0) k0 = 0;
    if (k1 > nsub - 1) k1 = nsub - 1;
    const float slope = (x1 - x0) / (y1 - y0);
    for (int k = k0; k <= k1; ++k) {
      const float yc = (float)rcY + ((float)k + 0.5f) * 0.5f;
      const float x = x0 + (yc - y0) * slope;
      if (x < subL[k]) subL[k] = x;
      if (x > subR[k]) subR[k] = x;
    }
  }

  const int lo = clX0, hi = clX1;
  const int r0 = clY0 - rcY, r1 = clY1 - rcY;
  for (int r = r0; r <= r1; ++r) {
    float a1 = subL[2 * r], b1 = subR[2 * r];
    float a2 = subL[2 * r + 1], b2 = subR[2 * r + 1];
    const bool h1 = a1 <= b1, h2 = a2 <= b2;
    if (!h1 && !h2) continue;
    if (!h1) { a1 = a2; b1 = a2; }   // empty sub-row: zero-width interval
    if (!h2) { a2 = a1; b2 = a1; }

    uint16_t *row = win + (size_t)r * rcW;
    int px0 = (int)floorf(fminf(a1, a2));
    int px1 = (int)ceilf(fmaxf(b1, b2)) - 1;
    int inL = (int)ceilf(fmaxf(a1, a2));           // inside both intervals
    int inR = (int)floorf(fminf(b1, b2)) - 1;
    if (px0 < lo) px0 = lo;
    if (px1 > hi) px1 = hi;
    if (inL < px0) inL = px0;
    if (inR > px1) inR = px1;

    // This row's shade and highlight intervals, and the pixels that contain
    // their boundaries.
    const float yc = (float)(r + rcY) + 0.5f;
    float sA = 1e9f, sB = -1e9f, hA = 1e9f, hB = -1e9f;
    int bp[4], nbp = 0;
    if (ellipseRowSpan(paint.shade, yc, &sA, &sB)) {
      bp[nbp++] = (int)floorf(sA); bp[nbp++] = (int)floorf(sB);
    }
    if (ellipseRowSpan(paint.hi, yc, &hA, &hB)) {
      bp[nbp++] = (int)floorf(hA); bp[nbp++] = (int)floorf(hB);
    }
    for (int i = 1; i < nbp; ++i) {   // insertion sort, four elements
      const int v = bp[i]; int j = i - 1;
      while (j >= 0 && bp[j] > v) { bp[j + 1] = bp[j]; --j; }
      bp[j + 1] = v;
    }
    auto colorAt = [&](int x) -> uint16_t {
      const float fx = (float)x;
      float cs = fminf(sB, fx + 1.0f) - fmaxf(sA, fx);
      float ch = fminf(hB, fx + 1.0f) - fmaxf(hA, fx);
      cs = cs < 0.0f ? 0.0f : (cs > 1.0f ? 1.0f : cs);
      ch = ch < 0.0f ? 0.0f : (ch > 1.0f ? 1.0f : ch);
      return paint.table[(int)(cs * paint.shadeA + 0.5f)][(int)(ch * paint.hiA + 0.5f)];
    };

    // Rim pixels: body coverage from the two sub-rows, colour from the skin
    // under them so the shade reaches the silhouette edge.
    auto rimPixel = [&](int x) {
      const float fx = (float)x;
      float c1 = fminf(b1, fx + 1.0f) - fmaxf(a1, fx);
      float c2 = fminf(b2, fx + 1.0f) - fmaxf(a2, fx);
      if (c1 < 0.0f) c1 = 0.0f;
      if (c2 < 0.0f) c2 = 0.0f;
      int a = (int)((c1 + c2) * 16.0f + 0.5f);
      if (a <= 0) return;
      if (a > 32) a = 32;
      uint16_t *p = row + (x - rcX);
      const uint16_t color = colorAt(x);
      *p = (a == 32) ? color : blend565(*p, color, a);
    };
    for (int x = px0; x < inL && x <= px1; ++x) rimPixel(x);
    for (int x = (inR + 1 > px0 ? inR + 1 : px0); x <= px1; ++x) rimPixel(x);

    // Interior: constant-colour runs between boundary pixels.
    int x = inL, bi = 0;
    while (x <= inR) {
      while (bi < nbp && bp[bi] < x) ++bi;
      if (bi < nbp && bp[bi] == x) { row[x - rcX] = colorAt(x); ++x; continue; }
      const int runEnd = (bi < nbp && bp[bi] - 1 < inR) ? bp[bi] - 1 : inR;
      const uint16_t c = colorAt(x);
      for (; x <= runEnd; ++x) row[x - rcX] = c;
    }
  }
}

// A closed eye: a quadratic arc from (x0,y0) through control (cx,cy) to
// (x1,y1), stroked as overlapping anti-aliased dots of radius r.
static void arcStroke(float x0, float y0, float cx, float cy, float x1, float y1,
                      float r, uint16_t color) {
  const float len = fabsf(x1 - x0) + fabsf(y1 - y0);
  int n = (int)(len / (r * 0.6f)) + 2;
  if (n > 48) n = 48;
  for (int i = 0; i <= n; ++i) {
    const float t = (float)i / (float)n, u = 1.0f - t;
    const float x = u * u * x0 + 2.0f * u * t * cx + t * t * x1;
    const float y = u * u * y0 + 2.0f * u * t * cy + t * t * y1;
    ellipseRot(x, y, r, r, 0.0f, color);
  }
}
