#pragma once

#include <stdint.h>
#include <string.h>
#include <stdio.h>
#include <stdarg.h>
#include "paper_gfx.h"
#include "FreeSerifBold12pt7b.h"
#include "FreeSerifBold9pt7b.h"
#include "TomThumb.h"

// The screen is the potato. Its body fills the upper page, lying down; its
// name and variety in small type beneath; then its line (≤ 60 chars); and,
// when the Question is open, the options numbered 1..3 — the vote is BOOT
// pressed N times, and the chosen row prints inverted. Red ink only where
// the variety is red; yellow nowhere here. No masthead, no columns: a
// Bulletin headline arrives as a line like any other.
//
// Unregistered and off the Net, the page is the join card instead, with a
// small potato at the bottom. Host-portable: no Arduino here.

static const int PAPER_MAX_OPTIONS = 3;

struct PaperModel {
  char name[32];
  char variety[24];          // id from assets/varieties.json
  char potatoId[16];
  char claim[16];
  bool showClaim;
  uint8_t expression;        // Expression enum value from protocol.h
  bool alarmed;              // cue: incident
  bool glance;               // file_unread > 0: eyes toward the edge
  char line[128];
  char options[PAPER_MAX_OPTIONS][17];
  uint8_t nOptions;
  int8_t chosen;             // -1 none; index of the confirmed option
  char status[24];           // tiny, top right: "NO NET", "REGISTERING", ""
  char joinAp[16];           // unregistered and off the Net: the portal's AP name
  char joinFailSsid[33];     // a saved network that would not connect
};

// What was drawn, as lines of text, for the serial log.
struct PaperLog {
  char text[1200];
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

static void upper(char *s) { for (; *s; ++s) if (*s >= 'a' && *s <= 'z') *s = (char)(*s - 'a' + 'A'); }

static EyeStyle eyesFor(const PaperModel &m) {
  if (m.alarmed) return EYES_WIDE;
  switch (m.expression) {
    case 2: return EYES_SLIT;             // aggrieved
    case 4: case 5: return EYES_ARC;      // asleep, dormant
    default: return EYES_OVAL;            // neutral, waiting, pleased, sprouted
  }
}

static const char *eyeName(EyeStyle e) {
  return e == EYES_SLIT ? "slits" : e == EYES_ARC ? "arcs" : e == EYES_WIDE ? "wide" : "ovals";
}

// Body text in the 5x7, centred. Returns the y after the last line.
static int drawCentredLines(PaperCanvas &cv, int yTop, const char *text, int maxLines, int lineH, uint8_t color,
                            PaperLog *log, const char *tag) {
  char lines[4][WRAP_CAP];
  bool trunc = false;
  const int n = wrapText(FONT_BODY, text, PAGE_W, lines, maxLines > 4 ? 4 : maxLines, &trunc);
  int y = yTop;
  for (int i = 0; i < n; ++i) {
    drawTextCentered(cv, PAPER_W / 2, y + 7, lines[i], FONT_BODY, color);
    if (log) log->add("  %s%s", i == 0 ? tag : "      ", lines[i]);
    y += lineH;
  }
  if (trunc && log) log->add("  (cut)");
  return y;
}

static void renderJoinPage(PaperCanvas &cv, const PaperModel &m, PaperLog *log) {
  int y = 20;
  drawTextCentered(cv, PAPER_W / 2, y + fontCapHeight(FONT_HEAD_S), "NOT YET A CITIZEN.", FONT_HEAD_S, PAPER_BLACK);
  if (log) log->add("  NOT YET A CITIZEN.");
  y = 62;
  drawTextCentered(cv, PAPER_W / 2, y, "JOIN WI-FI", FONT_HEAD_L, PAPER_BLACK);
  y += fontCapHeight(FONT_HEAD_L) + 9;
  const Font &apFont = textWidth(FONT_HEAD_L, m.joinAp) <= PAGE_W ? FONT_HEAD_L : FONT_HEAD_S;
  drawTextCentered(cv, PAPER_W / 2, y, m.joinAp, apFont, PAPER_BLACK);
  y += 16;
  drawTextCentered(cv, PAPER_W / 2, y, "then open 192.168.4.1", FONT_BODY, PAPER_BLACK);
  if (log) log->add("  JOIN WI-FI / %s / then open 192.168.4.1", m.joinAp);
  if (m.joinFailSsid[0]) {
    char msg[96];
    snprintf(msg, sizeof(msg), "Could not join %s. Try again.", m.joinFailSsid);
    drawCentredLines(cv, y + 6, msg, 2, 8, PAPER_BLACK, log, "");
  }
  // A small potato at the bottom, unnamed.
  drawPotato(cv, PAGE_X, PAPER_H - PORTRAIT_H - 10, PORTRAIT_ART, skinFor(""), EYES_OVAL, false);
  drawText(cv, PAGE_X, PAPER_H - 2, "UNREGISTERED", FONT_TINY, PAPER_BLACK);
  if (log) log->add("footer: UNREGISTERED");
}

static void renderPaper(PaperCanvas &cv, const PaperModel &m, PaperLog *log) {
  cv.clear(PAPER_WHITE);
  if (m.joinAp[0] && !m.name[0]) { renderJoinPage(cv, m, log); return; }

  // The potato, 140 px wide, centred about 40 % down.
  const int px = (PAPER_W - POTATO_W) / 2, py = 80 - POTATO_H / 2;
  const SkinStyle skin = skinFor(m.variety);
  const EyeStyle eyes = eyesFor(m);
  drawPotato(cv, px, py, POTATO_ART, skin, eyes, m.glance);
  if (log) log->add("potato: %s skin %s %d/16%s, eyes %s%s", m.variety[0] ? m.variety : "(no variety)",
                    skin.ink == PAPER_RED ? "red" : "black", skin.density, skin.flecks ? " + red flecks" : "",
                    eyeName(eyes), m.glance ? ", glancing" : "");

  // Status, tiny, top right.
  if (m.status[0]) drawText(cv, PAPER_W - PAGE_X - textWidth(FONT_TINY, m.status), 7, m.status, FONT_TINY, PAPER_BLACK);

  // Name and variety under the potato.
  char who[64];
  if (m.name[0]) {
    char nm[32], vr[24];
    asciiFold(m.name, nm, sizeof(nm)); upper(nm);
    asciiFold(m.variety, vr, sizeof(vr)); upper(vr);
    for (char *c = vr; *c; ++c) if (*c == '_') *c = ' ';
    if (m.showClaim && m.claim[0]) snprintf(who, sizeof(who), "%s #%s %c FILE %s", nm, m.potatoId, CH_MIDDOT, m.claim);
    else snprintf(who, sizeof(who), "%s #%s %c %s", nm, m.potatoId, CH_MIDDOT, vr);
  } else {
    snprintf(who, sizeof(who), "A POTATO, NOT YET NAMED");
  }
  int y = py + POTATO_H + 4;            // 132
  drawTextCentered(cv, PAPER_W / 2, y + 7, who, FONT_BODY, PAPER_BLACK);
  if (log) { char t[64]; asciiFold(who, t, sizeof(t)); for (char *c = t; *c; ++c) if ((uint8_t)*c == CH_MIDDOT) *c = '*'; log->add("name: %s%s%s", t, m.status[0] ? "  |  " : "", m.status); }
  y += 11;                              // 143

  // The line, then the options.
  const bool question = m.nOptions > 0;
  y = drawCentredLines(cv, y, m.line, question ? 2 : 3, 8, PAPER_BLACK, log, "line: ");
  if (question) {
    y = y < 166 ? 166 : y;
    const int rowH = 11;
    for (int i = 0; i < m.nOptions && i < PAPER_MAX_OPTIONS; ++i) {
      if (y + rowH > PAPER_H) break;
      const bool chosen = m.chosen == i;
      const uint8_t ink = chosen ? PAPER_WHITE : PAPER_BLACK;
      if (chosen) cv.fillRect(0, y, PAPER_W, rowH, PAPER_BLACK);
      char row[24];
      snprintf(row, sizeof(row), "%d %s", i + 1, m.options[i]);
      drawText(cv, 8, y + 9, row, FONT_BODY, ink);
      if (log) log->add("  %s%s", row, chosen ? "   <-- chosen" : "");
      y += rowH;
    }
  }
}
