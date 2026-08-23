#pragma once

#include <string.h>
#include "Arduino_GFX_Library.h"
#include "board_pins.h"
#include "potato_shape.h"
#include "protocol.h"
#include "FreeSans18pt7b.h"
#include "FreeSans12pt7b.h"
#include "FreeSansBold9pt7b.h"

// The lower band of the panel: one line of text under the potato and up to
// three buttons along the bottom. Rendered into its own PSRAM canvas with
// Arduino_GFX's font engine and flushed as one even-aligned blit whenever
// something changes — text changes a few times an hour, not per frame.
//
// Old-school lives in the type: GFX bitmap fonts, one weight for the line,
// a bold small-caps feel for the buttons, no anti-aliasing, no chrome.

static const int TEXT_Y = 292;                     // even; body stays above
static const int TEXT_H = LCD_HEIGHT - TEXT_Y;     // 156, even
static const int LINE_BAND_H = 92;                 // two 18pt lines, centred
static const int BTN_TOP = 100;                    // canvas-local
static const int BTN_H = 50;
static const int BTN_GAP = 8;
static const int BTN_RADIUS = 4;

static const uint16_t PAPER = RGB565(0xE8, 0xDF, 0xCB);
static const uint16_t BLACK = 0x0000;

// Arduino_Canvas allocates its framebuffer with aligned_alloc, which on this
// core lands in internal RAM. The blit buffer already owns 148KB of that and
// Wi-Fi wants the rest, so the text canvas lives in PSRAM instead.
class TextCanvas : public Arduino_Canvas {
 public:
  TextCanvas(Arduino_G *out)
      : Arduino_Canvas(LCD_WIDTH, TEXT_H, out, 0, TEXT_Y, 0) {}
  bool beginPsram() {
    _framebuffer = (uint16_t *)ps_malloc((size_t)LCD_WIDTH * TEXT_H * sizeof(uint16_t));
    if (!_framebuffer) return false;
    return begin(GFX_SKIP_OUTPUT_BEGIN);
  }
};

static TextCanvas *canvas = nullptr;
static char uiLine[MAX_LINE] = "";
static Choice uiChoices[MAX_CHOICES];
static uint8_t uiChoiceCount = 0;
static int8_t uiPressed = -1;
static bool uiDirty = true;
static bool uiBlanked = false;
static uint32_t uiFlushUs = 0;

static bool uiBegin(Arduino_G *out) {
  canvas = new TextCanvas(out);
  if (!canvas->beginPsram()) return false;
  canvas->fillScreen(BLACK);
  canvas->setTextWrap(false);
  return true;
}

static void uiSetLine(const char *s) {
  if (strncmp(uiLine, s, MAX_LINE) == 0 && !uiBlanked) return;
  strncpy(uiLine, s, MAX_LINE - 1);
  uiLine[MAX_LINE - 1] = 0;
  uiDirty = true;
}

static void uiSetChoices(const Choice *c, uint8_t n) {
  if (n > MAX_CHOICES) n = MAX_CHOICES;
  uiChoiceCount = n;
  for (uint8_t i = 0; i < n; ++i) uiChoices[i] = c[i];
  uiPressed = -1;
  uiDirty = true;
}

static void uiSetPressed(int8_t i) {
  if (uiPressed == i) return;
  uiPressed = i;
  uiDirty = true;
}

// Blank everything (the drop). The next uiSetLine or uiDraw repaints.
static void uiBlank() {
  canvas->fillScreen(BLACK);
  canvas->flush();
  uiBlanked = true;
  uiDirty = true;
}

static int16_t textWidth(const char *s) {
  int16_t x1, y1; uint16_t w, h;
  canvas->getTextBounds(s, 0, 0, &x1, &y1, &w, &h);
  return (int16_t)w;
}

// Greedy word wrap into at most maxLines lines of at most maxW pixels with
// the current font. Returns the line count, or maxLines + 1 if it will not fit.
static int wrapText(const char *text, int maxW, int maxLines,
                    char lines[][MAX_LINE]) {
  int n = 0;
  char cur[MAX_LINE] = "";
  const char *p = text;
  while (*p) {
    while (*p == ' ') ++p;
    if (!*p) break;
    const char *e = p;
    while (*e && *e != ' ') ++e;
    char word[MAX_LINE];
    const size_t wl = (size_t)(e - p) < MAX_LINE - 1 ? (size_t)(e - p) : MAX_LINE - 1;
    memcpy(word, p, wl); word[wl] = 0;
    p = e;

    char trial[MAX_LINE];
    if (cur[0]) snprintf(trial, sizeof(trial), "%s %s", cur, word);
    else snprintf(trial, sizeof(trial), "%s", word);
    if (textWidth(trial) <= maxW || !cur[0]) {
      strncpy(cur, trial, MAX_LINE - 1);
    } else {
      if (n >= maxLines) return maxLines + 1;
      strncpy(lines[n++], cur, MAX_LINE - 1);
      strncpy(cur, word, MAX_LINE - 1);
    }
  }
  if (cur[0]) {
    if (n >= maxLines) return maxLines + 1;
    strncpy(lines[n++], cur, MAX_LINE - 1);
  }
  return n;
}

static void drawCentered(const char *s, int cx, int baseline) {
  int16_t x1, y1; uint16_t w, h;
  canvas->getTextBounds(s, 0, 0, &x1, &y1, &w, &h);
  canvas->setCursor((int16_t)(cx - (int)w / 2 - x1), (int16_t)baseline);
  canvas->print(s);
}

static void drawLineBand() {
  static char lines[3][MAX_LINE];
  const int maxW = LCD_WIDTH - 16;
  const GFXfont *font = &FreeSans18pt7b;
  canvas->setFont(font);
  int n = wrapText(uiLine, maxW, 2, lines);
  if (n > 2) {
    // Too long for two big lines: drop a size rather than clip a sentence.
    font = &FreeSans12pt7b;
    canvas->setFont(font);
    n = wrapText(uiLine, maxW, 3, lines);
    if (n > 3) n = 3;
  }
  const int adv = font->yAdvance;
  const int ascent = (adv * 3) / 4;
  const int total = n * adv;
  const int top = (LINE_BAND_H - total) / 2;
  canvas->setTextColor(PAPER);
  for (int i = 0; i < n; ++i) {
    drawCentered(lines[i], LCD_WIDTH / 2, top + i * adv + ascent);
  }
}

static void buttonRect(int i, int *x, int *w) {
  const int n = uiChoiceCount;
  const int total = LCD_WIDTH - BTN_GAP * (n + 1);
  *w = total / n;
  *x = BTN_GAP + i * (*w + BTN_GAP);
}

static void drawButtons() {
  canvas->setFont(&FreeSansBold9pt7b);
  const int adv = FreeSansBold9pt7b.yAdvance;
  const int ascent = (adv * 3) / 4;
  for (int i = 0; i < uiChoiceCount; ++i) {
    int x, w;
    buttonRect(i, &x, &w);
    const bool pressed = (uiPressed == i);
    if (pressed) {
      canvas->fillRoundRect(x, BTN_TOP, w, BTN_H, BTN_RADIUS, PAPER);
    } else {
      canvas->drawRoundRect(x, BTN_TOP, w, BTN_H, BTN_RADIUS, PAPER);
      canvas->drawRoundRect(x + 1, BTN_TOP + 1, w - 2, BTN_H - 2, BTN_RADIUS - 1, PAPER);
    }
    canvas->setTextColor(pressed ? BLACK : PAPER);
    static char lines[2][MAX_LINE];
    int n = wrapText(uiChoices[i].label, w - 10, 2, lines);
    if (n > 2) n = 2;
    const int top = BTN_TOP + (BTN_H - n * adv) / 2;
    for (int k = 0; k < n; ++k) {
      drawCentered(lines[k], x + w / 2, top + k * adv + ascent);
    }
  }
}

static void uiDraw() {
  if (!uiDirty) return;
  const uint32_t t0 = micros();
  canvas->fillScreen(BLACK);
  if (uiLine[0]) drawLineBand();
  if (uiChoiceCount) drawButtons();
  canvas->flush();
  uiFlushUs = micros() - t0;
  uiDirty = false;
  uiBlanked = false;
}

// Which button is under a screen-space touch, or -1.
static int uiButtonAt(int sx, int sy) {
  const int cy = sy - TEXT_Y;
  if (cy < BTN_TOP - 6 || cy > BTN_TOP + BTN_H + 6) return -1;
  for (int i = 0; i < uiChoiceCount; ++i) {
    int x, w;
    buttonRect(i, &x, &w);
    if (sx >= x - 4 && sx < x + w + 4) return i;
  }
  return -1;
}
