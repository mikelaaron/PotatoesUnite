#pragma once

#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include <stdarg.h>
#include "paper_gfx.h"
#include "FreeSerifBold12pt7b.h"
#include "FreeSerifBold9pt7b.h"
#include "TomThumb.h"

// The page. An old newspaper, not a dashboard: a tiny masthead, the
// headline large and black, two items small, a rule, and at the bottom the
// potato's own line beside its portrait. Red only for an incident and the
// words MISSING / INCIDENT; yellow only for the mark on a confirmed vote.
// When the Question is open the lower half is the Question and its options.
//
// Host-portable: no Arduino here. The .ino fills a PaperModel; this draws it.

static const int PAPER_MAX_ITEMS = 2;
static const int PAPER_MAX_OPTIONS = 3;

struct PaperModel {
  // The Bulletin.
  bool hasBulletin;
  int no;
  char edition[10];          // "MORNING" | "EVENING"
  char headline[80];
  char items[PAPER_MAX_ITEMS][160];
  uint8_t nItems;
  bool incident;             // cue: incident → red headline
  // The potato.
  char line[128];            // its own scene line, ≤ 60
  char name[32];
  char variety[24];
  char potatoId[16];
  char claim[16];
  bool showClaim;
  uint8_t eyes;              // 0 open, 1 narrowed, 2 shut
  PortraitDither dither;
  // The Question (choices present).
  bool question;
  char qText[128];
  char options[PAPER_MAX_OPTIONS][17];
  uint8_t nOptions;
  int8_t cursor;
  int8_t chosen;             // -1 none; index of the confirmed option
  // Tiny status at the bottom right, e.g. "NO NET" or "".
  char status[24];
};

// What was drawn, as lines of text, for the serial log.
struct PaperLog {
  char text[1400];
  int len = 0;
  void add(const char *fmt, ...) {
    if (len >= (int)sizeof(text) - 2) return;
    va_list ap;
    va_start(ap, fmt);
    const int n = vsnprintf(text + len, sizeof(text) - len - 1, fmt, ap);
    va_end(ap);
    if (n > 0) len += n < (int)sizeof(text) - len - 1 ? n : (int)sizeof(text) - len - 1;
    if (len < (int)sizeof(text) - 1) text[len++] = '\n';
    text[len] = 0;
  }
};

static const Font FONT_HEAD_L = {&FreeSerifBold12pt7b, 1};
static const Font FONT_HEAD_S = {&FreeSerifBold9pt7b, 1};
static const Font FONT_BODY = {nullptr, 1};       // 5x7: 33 chars across the page
static const Font FONT_TINY = {&TomThumb, 1};     // 4 px advance

static const int PAGE_X = 2;
static const int PAGE_W = PAPER_W - 2 * PAGE_X;

static bool wordIsAlarm(const char *w) {
  char buf[16];
  size_t n = 0;
  for (; w[n] && n < sizeof(buf) - 1; ++n) {
    if (w[n] == '.' || w[n] == ',' || w[n] == ':' || w[n] == ' ') break;
    buf[n] = w[n];
  }
  buf[n] = 0;
  return !strcmp(buf, "INCIDENT") || !strcmp(buf, "MISSING");
}

// A headline line, word by word, so MISSING and INCIDENT can be red on their own.
static void drawHeadlineLine(PaperCanvas &cv, int x, int y, const char *s, const Font &f, bool allRed) {
  const char *p = s;
  while (*p) {
    const char *e = p;
    while (*e && *e != ' ') ++e;
    char word[WRAP_CAP];
    const size_t n = (size_t)(e - p) < sizeof(word) - 1 ? (size_t)(e - p) : sizeof(word) - 1;
    memcpy(word, p, n);
    word[n] = 0;
    const uint8_t color = (allRed || wordIsAlarm(word)) ? PAPER_RED : PAPER_BLACK;
    x += drawText(cv, x, y, word, f, color);
    if (*e == ' ') { x += glyphAdvance(f, ' '); ++e; }
    p = e;
  }
}

// Headline: the large serif if it fits in `maxLines`, else the small one; the
// small one may run to maxLines + 1. Returns the baseline of the last line.
// A headline that needs two lines breaks where the halves are most even,
// not where the first line happens to fill: "AN INQUIRY, / 9 TO 5 TO 3."
static bool balanceTwoLines(const Font &f, const char *text, int maxW, char out[][WRAP_CAP]) {
  int best = -1, bestMax = 1 << 30;
  const int len = (int)strlen(text);
  for (int i = 1; i < len - 1 && i < WRAP_CAP - 1; ++i) {
    if (text[i] != ' ') continue;
    char a[WRAP_CAP], b[WRAP_CAP];
    memcpy(a, text, i); a[i] = 0;
    strncpy(b, text + i + 1, WRAP_CAP - 1); b[WRAP_CAP - 1] = 0;
    const int wa = textWidth(f, a), wb = textWidth(f, b);
    if (wa > maxW || wb > maxW) continue;
    const int m = wa > wb ? wa : wb;
    if (m < bestMax) { bestMax = m; best = i; }
  }
  if (best < 0) return false;
  memcpy(out[0], text, best); out[0][best] = 0;
  strncpy(out[1], text + best + 1, WRAP_CAP - 1); out[1][WRAP_CAP - 1] = 0;
  return true;
}

static int drawHeadline(PaperCanvas &cv, int yTop, const char *text, bool red, int maxLines, PaperLog *log) {
  char lines[4][WRAP_CAP];
  bool trunc = false;
  const Font *f = &FONT_HEAD_L;
  int n = wrapText(FONT_HEAD_L, text, PAGE_W, lines, maxLines, &trunc);
  if (trunc) {
    f = &FONT_HEAD_S;
    n = wrapText(FONT_HEAD_S, text, PAGE_W, lines, maxLines + 1 <= 4 ? maxLines + 1 : 4, &trunc);
  }
  if (n == 2 && !trunc) balanceTwoLines(*f, text, PAGE_W, lines);
  const int cap = fontCapHeight(*f);
  const int lh = cap + 7;
  int y = yTop + cap;
  for (int i = 0; i < n; ++i) {
    drawHeadlineLine(cv, PAGE_X, y, lines[i], *f, red);
    if (log) log->add("  %s%s", red ? "[red] " : "", lines[i]);
    if (i < n - 1) y += lh;
  }
  if (trunc && log) log->add("  (headline cut)");
  return y;
}

// Body text in the 5x7. Returns the y after the last line drawn.
static int drawParagraph(PaperCanvas &cv, int x, int w, int yTop, int yLimit, const char *text, int maxLines,
                         PaperLog *log, const char *tag) {
  char lines[4][WRAP_CAP];
  bool trunc = false;
  int n = wrapText(FONT_BODY, text, w, lines, maxLines > 4 ? 4 : maxLines, &trunc);
  int y = yTop;
  for (int i = 0; i < n; ++i) {
    if (y + 8 > yLimit) { trunc = true; break; }
    drawText(cv, x, y + 7, lines[i], FONT_BODY, PAPER_BLACK);
    if (log) log->add("  %s%s", i == 0 ? tag : "    ", lines[i]);
    y += 8;
  }
  if (trunc && log) log->add("  (cut)");
  return y;
}

// The vote: a yellow box with a cross, the one place yellow is spent.
static void drawVotedMark(PaperCanvas &cv, int x, int yMid, uint8_t ink) {
  cv.fillRect(x, yMid - 4, 9, 9, PAPER_YELLOW);
  cv.rect(x, yMid - 4, 9, 9, ink);
  for (int i = 0; i < 9; ++i) { cv.set(x + i, yMid - 4 + i, ink); cv.set(x + 8 - i, yMid - 4 + i, ink); }
}

static void renderPaper(PaperCanvas &cv, const PaperModel &m, PaperLog *log) {
  cv.clear(PAPER_WHITE);
  char buf[160];

  // Masthead. Tiny, centred, between two rules.
  if (m.hasBulletin) snprintf(buf, sizeof(buf), "THE BULLETIN %c No. %d %c %s", CH_MIDDOT, m.no, CH_MIDDOT, m.edition);
  else snprintf(buf, sizeof(buf), "THE BULLETIN %c NOT YET PRINTED", CH_MIDDOT);
  drawTextCentered(cv, PAPER_W / 2, 9, buf, FONT_BODY, PAPER_BLACK);
  cv.hline(0, 12, PAPER_W, PAPER_BLACK);
  cv.hline(0, 14, PAPER_W, PAPER_BLACK);
  if (log) { char t[160]; asciiFold(buf, t, sizeof(t)); for (char *c = t; *c; ++c) if ((uint8_t)*c == CH_MIDDOT) *c = '*'; log->add("masthead: %s", t); }

  // Headline.
  const char *head = m.hasBulletin ? m.headline : (m.name[0] ? "THE NET HAS NOT SPOKEN." : "NOT YET A CITIZEN.");
  int y = drawHeadline(cv, 18, head, m.incident, m.question ? 2 : 2, log);
  y += 5;
  cv.hline(PAGE_X, y, PAGE_W, PAPER_BLACK);
  y += 4;

  // The lower block: either the Question or the potato's own line.
  const int bottomTop = m.question ? 96 : 163;

  // Items, as many as fit above the lower block.
  if (m.hasBulletin) {
    for (int i = 0; i < m.nItems && i < PAPER_MAX_ITEMS; ++i) {
      if (y + 8 > bottomTop - 2) break;
      char tag[8];
      snprintf(tag, sizeof(tag), "%d: ", i + 1);
      y = drawParagraph(cv, PAGE_X, PAGE_W, y, bottomTop - 2, m.items[i], 4, log, tag);
      y += 3;
    }
  } else if (!m.question) {
    y = drawParagraph(cv, PAGE_X, PAGE_W, y, bottomTop - 2,
                      m.name[0] ? "The Bulletin prints at 07:30 and 18:30. Until then, the Net." :
                                  "Waiting for the Net to assign a name.", 4, log, "   ");
  }

  if (m.question) {
    // The Question: its text, then the options with a cursor.
    y = bottomTop;
    cv.hline(0, y, PAPER_W, PAPER_BLACK);
    cv.hline(0, y + 2, PAPER_W, PAPER_BLACK);
    y += 6;
    y = drawParagraph(cv, PAGE_X, PAGE_W, y, 140, m.qText, 3, log, "Q: ");
    y += 4;
    // The cursor is the inverted row; the vote is the box at the left. The
    // serif if every label fits beside the box, else the 5x7.
    const int lx = 18;
    const Font *of = &FONT_HEAD_S;
    for (int i = 0; i < m.nOptions && i < PAPER_MAX_OPTIONS; ++i)
      if (textWidth(*of, m.options[i]) > PAPER_W - lx - PAGE_X) of = &FONT_BODY;
    const int rowH = 19;
    for (int i = 0; i < m.nOptions && i < PAPER_MAX_OPTIONS; ++i) {
      const int mid = y + rowH / 2;
      const bool cur = m.cursor == i;
      const uint8_t ink = cur ? PAPER_WHITE : PAPER_BLACK;
      if (cur) cv.fillRect(0, y, PAPER_W, rowH, PAPER_BLACK);
      if (m.chosen == i) drawVotedMark(cv, 4, mid, ink);
      drawText(cv, lx, mid + fontCapHeight(*of) / 2, m.options[i], *of, ink);
      if (log) log->add("  %c %s%s", cur ? '>' : ' ', m.options[i], m.chosen == i ? "  [x]" : "");
      y += rowH;
    }
  } else {
    // The potato's own line beside its portrait.
    y = bottomTop;
    cv.hline(0, y, PAPER_W, PAPER_BLACK);
    drawPortrait(cv, PAGE_X, y + 5, m.dither, m.eyes);
    const int lx = PAGE_X + PORTRAIT_W + 6;
    const char *line = m.line[0] ? m.line : "";
    drawParagraph(cv, lx, PAPER_W - lx - PAGE_X, y + 4, y + 4 + 3 * 8 + 1, line, 3, log, "line: ");
  }

  // Footer, tiny: who this is, and the Net's state at the right.
  {
    char who[64];
    if (m.name[0]) {
      char nm[32];
      asciiFold(m.name, nm, sizeof(nm));
      for (char *c = nm; *c; ++c) if (*c >= 'a' && *c <= 'z') *c = (char)(*c - 'a' + 'A');
      char vr[24];
      asciiFold(m.variety, vr, sizeof(vr));
      for (char *c = vr; *c; ++c) if (*c >= 'a' && *c <= 'z') *c = (char)(*c - 'a' + 'A');
      if (m.showClaim && m.claim[0]) snprintf(who, sizeof(who), "%s #%s %c FILE %s", nm, m.potatoId, CH_MIDDOT, m.claim);
      else snprintf(who, sizeof(who), "%s #%s %c %s", nm, m.potatoId, CH_MIDDOT, vr);
    } else {
      snprintf(who, sizeof(who), "UNREGISTERED");
    }
    drawText(cv, PAGE_X, PAPER_H - 2, who, FONT_TINY, PAPER_BLACK);
    if (m.status[0]) drawText(cv, PAPER_W - PAGE_X - textWidth(FONT_TINY, m.status), PAPER_H - 2, m.status, FONT_TINY, PAPER_BLACK);
    if (log) {
      char t[64]; asciiFold(who, t, sizeof(t)); for (char *c = t; *c; ++c) if ((uint8_t)*c == CH_MIDDOT) *c = '*';
      log->add("footer: %s%s%s", t, m.status[0] ? "  |  " : "", m.status);
    }
  }
}
