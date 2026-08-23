#pragma once

#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include <math.h>
#include "gfx_font.h"
#include "font5x7.h"
#include "portrait.h"

// A 200x200 four-colour canvas in the panel's own 2-bit format (four pixels
// per byte, MSB first: 0 black, 1 white, 2 yellow, 3 red), a text engine for
// Adafruit GFX fonts and the classic 5x7, word wrap, and the potato portrait.
// Host-portable on purpose: firmware/tools/paper_preview.cpp renders the same
// layout to an image so the 15 s refresh is not the edit loop.

enum PaperColor : uint8_t { PAPER_BLACK = 0, PAPER_WHITE = 1, PAPER_YELLOW = 2, PAPER_RED = 3 };

static const int PAPER_W = 200;
static const int PAPER_H = 200;
static const int PAPER_STRIDE = PAPER_W / 4;
static const int PAPER_BYTES = PAPER_STRIDE * PAPER_H;

// A middle dot, folded from UTF-8 U+00B7. The 5x7 font has one (CP437 0xFA);
// the GFX fonts get a drawn dot.
static const uint8_t CH_MIDDOT = 0xB7;

struct PaperCanvas {
  uint8_t buf[PAPER_BYTES];

  void clear(uint8_t c) {
    memset(buf, (uint8_t)((c << 6) | (c << 4) | (c << 2) | c), PAPER_BYTES);
  }
  void set(int x, int y, uint8_t c) {
    if ((unsigned)x >= (unsigned)PAPER_W || (unsigned)y >= (unsigned)PAPER_H) return;
    uint8_t &b = buf[y * PAPER_STRIDE + (x >> 2)];
    const int sh = 6 - 2 * (x & 3);
    b = (uint8_t)((b & ~(3 << sh)) | (c << sh));
  }
  uint8_t get(int x, int y) const {
    if ((unsigned)x >= (unsigned)PAPER_W || (unsigned)y >= (unsigned)PAPER_H) return PAPER_WHITE;
    return (buf[y * PAPER_STRIDE + (x >> 2)] >> (6 - 2 * (x & 3))) & 3;
  }
  void fillRect(int x, int y, int w, int h, uint8_t c) {
    for (int yy = y; yy < y + h; ++yy)
      for (int xx = x; xx < x + w; ++xx) set(xx, yy, c);
  }
  void hline(int x, int y, int w, uint8_t c) { fillRect(x, y, w, 1, c); }
  void vline(int x, int y, int h, uint8_t c) { fillRect(x, y, 1, h, c); }
  void rect(int x, int y, int w, int h, uint8_t c) {
    hline(x, y, w, c); hline(x, y + h - 1, w, c);
    vline(x, y, h, c); vline(x + w - 1, y, h, c);
  }
  // FNV-1a over the whole buffer: "did what I would show change?"
  uint32_t hash() const {
    uint32_t h = 2166136261u;
    for (int i = 0; i < PAPER_BYTES; ++i) { h ^= buf[i]; h *= 16777619u; }
    return h;
  }
};

// ------------------------------------------------------------------ fonts ---

// gfx == nullptr is the classic 5x7 (6 px advance, 8 px line) at `scale`.
struct Font {
  const GFXfont *gfx;
  uint8_t scale;
};

static inline int fontLineHeight(const Font &f) {
  return f.gfx ? f.gfx->yAdvance : 8 * f.scale;
}

// Height of a capital above the baseline.
static inline int fontCapHeight(const Font &f) {
  if (!f.gfx) return 7 * f.scale;
  if ('H' < f.gfx->first || 'H' > f.gfx->last) return f.gfx->yAdvance * 2 / 3;
  return -f.gfx->glyph['H' - f.gfx->first].yOffset;
}

static inline int glyphAdvance(const Font &f, uint8_t c) {
  if (!f.gfx) return 6 * f.scale;
  if (c == CH_MIDDOT) return glyphAdvance(f, '.');
  if (c < f.gfx->first || c > f.gfx->last) c = '?';
  return f.gfx->glyph[c - f.gfx->first].xAdvance;
}

static inline int textWidth(const Font &f, const char *s) {
  int w = 0;
  for (const uint8_t *p = (const uint8_t *)s; *p; ++p) w += glyphAdvance(f, *p);
  return w;
}

// Draw one glyph with its origin on the baseline at (x, y). Returns the advance.
static int drawGlyph(PaperCanvas &cv, int x, int y, uint8_t c, const Font &f, uint8_t color) {
  if (!f.gfx) {
    if (c == CH_MIDDOT) c = 0xFA;               // CP437 middle dot
    const int s = f.scale;
    const uint8_t *g = FONT5X7 + (int)c * 5;
    for (int col = 0; col < 5; ++col) {
      const uint8_t bits = g[col];
      for (int row = 0; row < 7; ++row) {
        if (bits & (1 << row)) cv.fillRect(x + col * s, y - 7 * s + row * s, s, s, color);
      }
    }
    return 6 * s;
  }
  if (c == CH_MIDDOT) {
    const int adv = glyphAdvance(f, '.');
    const int cap = fontCapHeight(f);
    cv.fillRect(x + adv / 2 - 1, y - cap / 2 - 1, 2, 2, color);
    return adv;
  }
  if (c < f.gfx->first || c > f.gfx->last) c = '?';
  const GFXglyph &g = f.gfx->glyph[c - f.gfx->first];
  const uint8_t *bitmap = f.gfx->bitmap + g.bitmapOffset;
  uint8_t bits = 0, bit = 0;
  for (int yy = 0; yy < g.height; ++yy) {
    for (int xx = 0; xx < g.width; ++xx) {
      if (!(bit++ & 7)) bits = *bitmap++;
      if (bits & 0x80) cv.set(x + g.xOffset + xx, y + g.yOffset + yy, color);
      bits <<= 1;
    }
  }
  return g.xAdvance;
}

static int drawText(PaperCanvas &cv, int x, int y, const char *s, const Font &f, uint8_t color) {
  int w = 0;
  for (const uint8_t *p = (const uint8_t *)s; *p; ++p) w += drawGlyph(cv, x + w, y, *p, f, color);
  return w;
}

static void drawTextCentered(PaperCanvas &cv, int cx, int y, const char *s, const Font &f, uint8_t color) {
  drawText(cv, cx - textWidth(f, s) / 2, y, s, f, color);
}

// ------------------------------------------------------------------- text ---

// The server sends UTF-8; the fonts are 7-bit plus the middle dot. Fold the
// punctuation the voice doc uses; drop anything else that is multibyte.
static void asciiFold(const char *in, char *out, size_t cap) {
  size_t o = 0;
  const uint8_t *p = (const uint8_t *)in;
  while (*p && o + 1 < cap) {
    if (*p < 0x80) { out[o++] = (char)*p++; continue; }
    const char *rep = "";
    int len = 1;
    if (p[0] == 0xC2 && p[1] == 0xB7) { len = 2; out[o++] = (char)CH_MIDDOT; p += len; continue; }
    else if (p[0] == 0xE2 && p[1] == 0x80) {
      len = 3;
      switch (p[2]) {
        case 0x98: case 0x99: rep = "'"; break;     // ‘ ’
        case 0x9C: case 0x9D: rep = "\""; break;    // “ ”
        case 0x93: case 0x94: rep = "-"; break;     // – —
        case 0xA6: rep = "..."; break;              // …
        default: rep = ""; break;
      }
    } else if (p[0] == 0xC3 && (p[1] == 0xA9 || p[1] == 0x89)) { len = 2; rep = p[1] == 0xA9 ? "e" : "E"; }  // é É
    else if ((p[0] & 0xE0) == 0xC0) len = 2;
    else if ((p[0] & 0xF0) == 0xE0) len = 3;
    else if ((p[0] & 0xF8) == 0xF0) len = 4;
    for (const char *r = rep; *r && o + 1 < cap; ++r) out[o++] = *r;
    for (int i = 0; i < len && *p; ++i) ++p;
  }
  out[o] = 0;
}

static const int WRAP_CAP = 64;

// Greedy word wrap. Fills up to maxLines lines; returns how many were used
// and sets *truncated if text was left over. A word wider than the column is
// broken at the width.
static int wrapText(const Font &f, const char *s, int maxW, char out[][WRAP_CAP], int maxLines,
                    bool *truncated) {
  int n = 0;
  if (truncated) *truncated = false;
  const char *p = s;
  while (*p == ' ') ++p;
  while (*p && n < maxLines) {
    char *line = out[n];
    int len = 0, w = 0;
    int lastSpace = -1, wAtSpace = 0;
    const char *q = p;
    while (*q && len < WRAP_CAP - 1) {
      const int adv = glyphAdvance(f, (uint8_t)*q);
      if (w + adv > maxW) break;
      if (*q == ' ') { lastSpace = len; wAtSpace = w; }
      line[len++] = *q;
      w += adv;
      ++q;
    }
    (void)wAtSpace;
    if (*q && *q != ' ' && lastSpace > 0) {   // mid-word: back up to the space
      len = lastSpace;
      q = p + len;
    }
    while (len > 0 && line[len - 1] == ' ') --len;
    line[len] = 0;
    if (len == 0 && *q) { line[0] = *q; line[1] = 0; ++q; }   // never loop forever
    while (*q == ' ') ++q;
    p = q;
    ++n;
  }
  if (*p && truncated) *truncated = true;
  return n;
}

// ----------------------------------------------------------------- potato ---

// The potato is the page. Body, underside shade and highlight are masks from
// assets/potato-look-v1.svg (portrait.h, two sizes); the skin is a dither in
// the variety's ink at the variety's density; dimples, eyes and the outline
// are black. Expressions are the AMOLED's, by eye shape.

static void fillEllipse(PaperCanvas &cv, int cx, int cy, int rx, int ry, uint8_t c) {
  if (rx < 1) rx = 1;
  if (ry < 1) ry = 1;
  for (int dy = -ry; dy <= ry; ++dy) {
    const float f = 1.0f - (float)(dy * dy) / (float)(ry * ry);
    const int hw = (int)(rx * sqrtf(f < 0.0f ? 0.0f : f) + 0.5f);
    cv.hline(cx - hw, cy + dy, 2 * hw + 1, c);
  }
}

struct PotatoArt {
  int w, h, stride;
  const uint8_t *body, *shade, *hi;
  const int8_t (*eyes)[2];
  const uint8_t *eyeR, *slit, *wide, *arc;
  uint8_t glanceDx;
  const int8_t (*dimples)[4];
  int nDimples;
  const int8_t (*flecks)[4];
  int nFlecks;
  uint8_t outline;        // px
};

static const PotatoArt POTATO_ART = {
    POTATO_W, POTATO_H, POTATO_STRIDE, &POTATO_BODY[0][0], &POTATO_SHADE[0][0], &POTATO_HI[0][0],
    POTATO_EYES, POTATO_EYE_R, POTATO_SLIT, POTATO_WIDE, POTATO_ARC, POTATO_GLANCE_DX,
    POTATO_DIMPLES, 4, POTATO_FLECKS, 3, 2};
static const PotatoArt PORTRAIT_ART = {
    PORTRAIT_W, PORTRAIT_H, PORTRAIT_STRIDE, &PORTRAIT_BODY[0][0], &PORTRAIT_SHADE[0][0], &PORTRAIT_HI[0][0],
    PORTRAIT_EYES, PORTRAIT_EYE_R, PORTRAIT_SLIT, PORTRAIT_WIDE, PORTRAIT_ARC, PORTRAIT_GLANCE_DX,
    PORTRAIT_DIMPLES, 4, PORTRAIT_FLECKS, 3, 1};

// assets/varieties.json, "dither" and "skin": how dark the skin prints and in
// which ink. Red and Désirée are red; King Edward is pink-flecked: red
// flecks on a pale skin. Everything else is black on white.
struct SkinStyle {
  uint8_t ink;        // PAPER_BLACK or PAPER_RED
  uint8_t density;    // sixteenths, before shade/highlight
  bool flecks;
};

static SkinStyle skinFor(const char *variety) {
  SkinStyle st = {PAPER_BLACK, 6, false};
  if (!strcmp(variety, "russet")) st.density = 8;
  else if (!strcmp(variety, "purple_majesty")) st.density = 9;
  else if (!strcmp(variety, "yukon_gold") || !strcmp(variety, "kennebec")) st.density = 4;
  else if (!strcmp(variety, "fingerling") || !strcmp(variety, "maris_piper") || !strcmp(variety, "charlotte")) st.density = 2;
  else if (!strcmp(variety, "red")) { st.ink = PAPER_RED; st.density = 7; }
  else if (!strcmp(variety, "desiree")) { st.ink = PAPER_RED; st.density = 6; }
  else if (!strcmp(variety, "king_edward")) { st.density = 3; st.flecks = true; }
  return st;
}

enum EyeStyle : uint8_t { EYES_OVAL = 0, EYES_SLIT, EYES_ARC, EYES_WIDE };

static const uint8_t BAYER4[4][4] = {{0, 8, 2, 10}, {12, 4, 14, 6}, {3, 11, 1, 9}, {15, 7, 13, 5}};

static inline bool artBit(const uint8_t *m, int stride, int x, int y) {
  return (m[y * stride + (x >> 3)] >> (7 - (x & 7))) & 1;
}

static bool artBody(const PotatoArt &a, int x, int y) {
  if (x < 0 || y < 0 || x >= a.w || y >= a.h) return false;
  return artBit(a.body, a.stride, x, y);
}

static void drawPotato(PaperCanvas &cv, int x0, int y0, const PotatoArt &a, const SkinStyle &skin,
                       EyeStyle eyes, bool glance) {
  for (int y = 0; y < a.h; ++y) {
    for (int x = 0; x < a.w; ++x) {
      if (!artBit(a.body, a.stride, x, y)) continue;
      bool edge = false;
      for (int d = 1; d <= a.outline && !edge; ++d)
        edge = !artBody(a, x - d, y) || !artBody(a, x + d, y) || !artBody(a, x, y - d) || !artBody(a, x, y + d);
      if (edge) { cv.set(x0 + x, y0 + y, PAPER_BLACK); continue; }
      int v = skin.density;
      if (artBit(a.shade, a.stride, x, y)) v += 3;
      if (artBit(a.hi, a.stride, x, y)) v -= 3;
      if (v < 0) v = 0;
      if (v > 15) v = 15;
      if (BAYER4[y & 3][x & 3] < v) cv.set(x0 + x, y0 + y, skin.ink);
    }
  }
  if (skin.flecks) {
    for (int i = 0; i < a.nFlecks; ++i) fillEllipse(cv, x0 + a.flecks[i][0], y0 + a.flecks[i][1], a.flecks[i][2], a.flecks[i][3], PAPER_RED);
  }
  for (int i = 0; i < a.nDimples; ++i) fillEllipse(cv, x0 + a.dimples[i][0], y0 + a.dimples[i][1], a.dimples[i][2], a.dimples[i][3], PAPER_BLACK);
  const int dx = glance && eyes != EYES_ARC ? a.glanceDx : 0;
  for (int i = 0; i < 2; ++i) {
    const int ex = x0 + a.eyes[i][0] + dx, ey = y0 + a.eyes[i][1];
    // A one-pixel halo so the eye reads against the dither, then the eye.
    switch (eyes) {
      case EYES_OVAL:
        fillEllipse(cv, ex, ey, a.eyeR[0] + 1, a.eyeR[1] + 1, PAPER_WHITE);
        fillEllipse(cv, ex, ey, a.eyeR[0], a.eyeR[1], PAPER_BLACK);
        break;
      case EYES_SLIT:
        fillEllipse(cv, ex, ey + a.slit[2], a.slit[0] + 1, a.slit[1] + 1, PAPER_WHITE);
        fillEllipse(cv, ex, ey + a.slit[2], a.slit[0], a.slit[1], PAPER_BLACK);
        break;
      case EYES_WIDE:
        fillEllipse(cv, ex, ey, a.wide[0] + 1, a.wide[1] + 1, PAPER_WHITE);
        fillEllipse(cv, ex, ey, a.wide[0], a.wide[1], PAPER_BLACK);
        if (a.wide[0] >= 4) fillEllipse(cv, ex, ey, a.wide[0] - 3, a.wide[1] - 4, PAPER_WHITE);   // a ring: startled
        break;
      case EYES_ARC: {
        const int hw = a.arc[0], depth = a.arc[1];
        fillEllipse(cv, ex, ey + depth / 2, hw + 1, depth + 2, PAPER_WHITE);
        for (int d = -hw; d <= hw; ++d) {
          const float t = (float)d / (float)hw;
          const int yy = ey + (int)(depth * (1.0f - t * t) + 0.5f);
          cv.set(ex + d, yy, PAPER_BLACK);
          if (a.outline > 1) cv.set(ex + d, yy + 1, PAPER_BLACK);
        }
        break;
      }
    }
  }
}

// ------------------------------------------------------------------- dump ---

// The screen as text, one character per cell, for the serial log and tests.
// `shrink` 1 prints 200x200; 2 prints 100x100 (any ink in the cell counts).
template <typename Emit>
static void dumpCanvas(const PaperCanvas &cv, int shrink, Emit emit) {
  char line[PAPER_W + 2];
  for (int y = 0; y < PAPER_H; y += shrink) {
    int n = 0;
    for (int x = 0; x < PAPER_W; x += shrink) {
      int black = 0, red = 0, yellow = 0;
      for (int dy = 0; dy < shrink; ++dy)
        for (int dx = 0; dx < shrink; ++dx) {
          const uint8_t c = cv.get(x + dx, y + dy);
          if (c == PAPER_BLACK) ++black;
          else if (c == PAPER_RED) ++red;
          else if (c == PAPER_YELLOW) ++yellow;
        }
      line[n++] = red ? 'R' : yellow ? 'Y' : black ? (shrink > 1 && black == 1 ? '+' : '#') : ' ';
    }
    line[n] = 0;
    emit(line);
  }
}
