#pragma once

#include <stdint.h>
#include <string.h>
#include <stdio.h>
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

// --------------------------------------------------------------- portrait ---

// Variety dithers from assets/varieties.json: how dark the skin prints.
enum PortraitDither : uint8_t { DITHER_NONE = 0, DITHER_FINE, DITHER_MEDIUM, DITHER_COARSE, DITHER_CHECKER };

static inline PortraitDither ditherFromName(const char *s) {
  if (!strcmp(s, "fine")) return DITHER_FINE;
  if (!strcmp(s, "medium")) return DITHER_MEDIUM;
  if (!strcmp(s, "coarse")) return DITHER_COARSE;
  if (!strcmp(s, "checker")) return DITHER_CHECKER;
  return DITHER_NONE;
}

static inline bool maskBit(const uint8_t m[PORTRAIT_H][PORTRAIT_STRIDE], int x, int y) {
  return (m[y][x >> 3] >> (7 - (x & 7))) & 1;
}

static const uint8_t BAYER4[4][4] = {{0, 8, 2, 10}, {12, 4, 14, 6}, {3, 11, 1, 9}, {15, 7, 13, 5}};

// Eyes: 0 neutral (open), 1 narrowed (aggrieved/waiting), 2 shut (asleep/dormant).
static void drawPortrait(PaperCanvas &cv, int x0, int y0, PortraitDither dither, int eyes) {
  for (int y = 0; y < PORTRAIT_H; ++y) {
    for (int x = 0; x < PORTRAIT_W; ++x) {
      if (!maskBit(PORTRAIT_BODY, x, y)) continue;
      // Outline: a body pixel with a non-body 4-neighbour.
      const bool edge = x == 0 || y == 0 || x == PORTRAIT_W - 1 || y == PORTRAIT_H - 1 ||
                        !maskBit(PORTRAIT_BODY, x - 1, y) || !maskBit(PORTRAIT_BODY, x + 1, y) ||
                        !maskBit(PORTRAIT_BODY, x, y - 1) || !maskBit(PORTRAIT_BODY, x, y + 1);
      if (edge) { cv.set(x0 + x, y0 + y, PAPER_BLACK); continue; }
      // Skin tone in sixteenths, darker underneath, lighter at the highlight.
      int v;
      switch (dither) {
        case DITHER_NONE: v = 0; break;
        case DITHER_FINE: v = 4; break;
        case DITHER_MEDIUM: v = 6; break;
        case DITHER_COARSE: v = 8; break;
        default: v = 8; break;
      }
      if (maskBit(PORTRAIT_SHADE, x, y)) v += 5;
      if (maskBit(PORTRAIT_HI, x, y)) v -= 4;
      if (v < 0) v = 0;
      if (v > 15) v = 15;
      bool dark;
      if (dither == DITHER_CHECKER) dark = ((x + y) & 1) == 0 && v > 0;
      else if (dither == DITHER_COARSE) dark = BAYER4[y & 1][x & 1] < v;   // 2x2 cells of the table
      else dark = BAYER4[y & 3][x & 3] < v;
      if (dark) cv.set(x0 + x, y0 + y, PAPER_BLACK);
    }
  }
  for (int i = 0; i < 4; ++i) cv.set(x0 + PORTRAIT_DIMPLES[i][0], y0 + PORTRAIT_DIMPLES[i][1], PAPER_BLACK);
  for (int i = 0; i < 2; ++i) {
    const int ex = x0 + PORTRAIT_EYES[i][0], ey = y0 + PORTRAIT_EYES[i][1];
    // Clear a halo so the eye reads against the dither.
    cv.fillRect(ex - 2, ey - 3, 5, 6, PAPER_WHITE);
    if (eyes == 0) { cv.fillRect(ex - 1, ey - 2, 3, 4, PAPER_BLACK); cv.set(ex - 1, ey - 2, PAPER_WHITE); cv.set(ex + 1, ey - 2, PAPER_WHITE); cv.set(ex - 1, ey + 1, PAPER_WHITE); cv.set(ex + 1, ey + 1, PAPER_WHITE); }
    else if (eyes == 1) cv.fillRect(ex - 1, ey - 1, 3, 2, PAPER_BLACK);
    else cv.fillRect(ex - 2, ey, 5, 1, PAPER_BLACK);
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
