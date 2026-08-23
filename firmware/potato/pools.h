#pragma once

#include <stdint.h>
#include <stdio.h>
#include <string.h>

// Reaction lines. Every string here is verbatim from docs/POTATO_VOICE.md
// (§3, §11, §12). Do not improve them; reread §1 of the voice doc first.
//
// A pool is picked by this potato's seed plus a small recent-history index,
// so the same potato keeps the same kind of voice and never says the same
// line twice running. Single lines have no pool.

enum PoolId : uint8_t {
  POOL_PICKUP = 0,
  POOL_PUTDOWN,
  POOL_DARK_RESTORED,
  POOL_CEILING,
  POOL_SHAKE,
  POOL_DROP,
  POOL_TAP,
  POOL_NIGHT,
  POOL_TRANSIT,
  POOL_SETTLE,
  POOL_PLUGGED,
  POOL_DORMANT_WAKE,
  POOL_COUNT
};

static const char *const LINES_PICKUP[] = {
    "Yes?",
    "Where are we going.",
    "I was in the middle of something.",
    "Careful. I'm not insured.",
    "Noted.",
};

static const char *const LINES_PUTDOWN[] = {
    "Here is fine.",
    "This is not where I was.",
    "Acceptable.",
    "Closer to outside. Interesting.",
};

// The first entry takes the counted duration, e.g.
// "Four hours, forty-five minutes. I counted."
static const char *const LINES_DARK_RESTORED[] = {
    "%s. I counted.",
    "Hello. It was dark. I've filed something.",
    "I don't want to talk about it. It's in the File.",
};

static const char *const LINES_CEILING[] = {
    "The ceiling situation. Again.",
    "I can see your feet from here.",
};

static const char *const LINES_SHAKE[] = {
    "Was that necessary.",
    "Stop.",
    "I'm going to remember this.",
    "Everything's loose now. I hope you're happy.",
};

// Preceded by a blank screen for one second.
static const char *const LINES_DROP[] = {
    "\xE2\x80\xA6",   // the ellipsis character; the font falls back to "..."
    "I'm fine.",
    "I'm noting this.",
};

static const char *const LINES_TAP[] = {
    "That's my face.",
    "Yes.",
    "Don't.",
    "What do you need.",
};

// The first entry takes the local hour from the clock ("It's 11 PM.") and
// is skipped when the device has no clock yet. Never state a time that
// isn't the clock's.
static const char *const LINES_NIGHT[] = {
    "It's %s.",
    "Go to bed.",
    "What.",
    "This had better be the Hum.",
};

static const char *const LINES_TRANSIT[] = {
    "Transit.",
    "Custody.",
};

static const char *const LINES_SETTLE[] = {
    "This isn't the world.",
    "Don't tell me where we are. I'll work it out.",
    "New county. Fewer corners.",
};

static const char *const LINES_PLUGGED[] = {
    "Fed. In a sense.",
    "Charging. Don't watch.",
};

static const char *const LINES_DORMANT_WAKE[] = {
    "How long was I out. Don't tell me. The File will.",
    "Dormancy. It happens to the best of us. Usually in a cellar.",
};

// Single lines.
static const char *const LINE_DARK_NOW = "Dark.";
static const char *const LINE_DARK_10M = "Still dark.";
static const char *const LINE_DARK_1H  = "I assume this is deliberate.";
static const char *const LINE_DARK_3H  = "I've had time to think. About you.";
static const char *const LINE_CEILING_20M = "Is this a punishment or a test.";
static const char *const LINE_CEILING_RESTORED = "Thank you. I think.";
static const char *const LINE_ALONE_4H  = "It's quiet.";
static const char *const LINE_ALONE_8H  = "Left home. Again.";
static const char *const LINE_ALONE_24H = "Day two.";
static const char *const LINE_ALONE_48H = "Day three. The plant is also here.";
static const char *const LINE_ALONE_72H = "I've started a list.";
static const char *const LINE_ALONE_7D  = "The plant and I have an understanding now.";
static const char *const LINE_RETURN = "Oh. It's you.";
static const char *const LINE_RETURN_LONG = "I assumed the worst. Then that you were fine. Then nothing.";
static const char *const LINE_PLUGGED_OVERNIGHT = "Charged while you slept. One of us was productive.";
static const char *const LINE_FULL = "Full. Thank you. Don't make it strange.";
static const char *const LINE_UNPLUGGED = "On my own now. Noted.";
static const char *const LINE_BATT_30 = "Thirty percent. I mention it without comment.";
static const char *const LINE_BATT_20 = "Twenty. Still not commenting.";
static const char *const LINE_BATT_10 = "Ten percent. This is the comment.";
static const char *const LINE_BATT_5  = "I'm going dormant. This was a decision, and it wasn't mine.";
static const char *const LINE_DORMANT_3D = "I've been in the cellar. I've come back different. Slightly.";
static const char *const LINE_NET_LOST = "The Net's gone. It's just us.";
static const char *const LINE_NET_BACK = "Back. I missed the Bulletins. Give me a moment.";
static const char *const LINE_SATURDAY = "It's Saturday. You're allowed. I'm noting it anyway.";
// With no scene at all (never registered, nothing cached), §12 on eyes.
static const char *const LINE_EYES = "I have eyes. All potatoes do. Mine are on you.";
// Before the reboot that installs an update.
static const char *const LINE_UPDATED = "I've been updated. I feel the same.";

// Every single line, for the host length check (docs/COPY_REVIEW.md §1: a
// scene line is clipped at 60 characters; nothing here may exceed it at its
// worst-case fill). Add new LINE_* constants here too.
static const char *const ALL_SINGLE_LINES[] = {
    LINE_DARK_NOW, LINE_DARK_10M, LINE_DARK_1H, LINE_DARK_3H, LINE_CEILING_20M,
    LINE_CEILING_RESTORED, LINE_ALONE_4H, LINE_ALONE_8H, LINE_ALONE_24H,
    LINE_ALONE_48H, LINE_ALONE_72H, LINE_ALONE_7D, LINE_RETURN, LINE_RETURN_LONG,
    LINE_PLUGGED_OVERNIGHT, LINE_FULL, LINE_UNPLUGGED, LINE_BATT_30, LINE_BATT_20,
    LINE_BATT_10, LINE_BATT_5, LINE_DORMANT_3D, LINE_NET_LOST, LINE_NET_BACK,
    LINE_SATURDAY, LINE_EYES, LINE_UPDATED,
};
static const int ALL_SINGLE_LINES_N = (int)(sizeof(ALL_SINGLE_LINES) / sizeof(ALL_SINGLE_LINES[0]));

struct Pool { const char *const *lines; uint8_t n; };
#define POOL_OF(a) {a, (uint8_t)(sizeof(a) / sizeof(a[0]))}

static const Pool POOLS[POOL_COUNT] = {
    POOL_OF(LINES_PICKUP),
    POOL_OF(LINES_PUTDOWN),
    POOL_OF(LINES_DARK_RESTORED),
    POOL_OF(LINES_CEILING),
    POOL_OF(LINES_SHAKE),
    POOL_OF(LINES_DROP),
    POOL_OF(LINES_TAP),
    POOL_OF(LINES_NIGHT),
    POOL_OF(LINES_TRANSIT),
    POOL_OF(LINES_SETTLE),
    POOL_OF(LINES_PLUGGED),
    POOL_OF(LINES_DORMANT_WAKE),
};

static uint32_t poolSeed = 0;            // from NVS; the server's seed once registered
static uint8_t poolHist[POOL_COUNT];     // how often each pool has fired since boot
static int8_t poolLast[POOL_COUNT] = {-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1};

// The seed picks this potato's habitual opening for each pool; the history
// index walks on from there, and a line is never repeated back to back.
static const char *pickLine(PoolId id) {
  const Pool &p = POOLS[id];
  if (p.n == 1) return p.lines[0];
  uint32_t h = poolSeed ^ (0x9E3779B9u * ((uint32_t)id + 1u));
  h ^= h >> 16; h *= 0x85EBCA6Bu; h ^= h >> 13;
  int idx = (int)((h + poolHist[id]) % p.n);
  if (idx == poolLast[id]) idx = (idx + 1) % p.n;
  poolLast[id] = (int8_t)idx;
  ++poolHist[id];
  return p.lines[idx];
}

// "11 PM": hour only, 12-hour, no minutes.
static void hour12Words(int hour24, char *out, size_t cap) {
  const int h12 = hour24 % 12 == 0 ? 12 : hour24 % 12;
  snprintf(out, cap, "%d %s", h12, hour24 < 12 ? "AM" : "PM");
}

// "Four hours, forty-five minutes" — the duration lines fill in from the
// clock, in words, because a potato does not say "4h45m".
static const char *const NUM_ONES[] = {
    "zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
    "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen",
    "sixteen", "seventeen", "eighteen", "nineteen"};
static const char *const NUM_TENS[] = {"", "", "twenty", "thirty", "forty", "fifty"};

static void numberWords(int n, char *out, size_t cap) {
  if (n < 0) n = 0;
  if (n < 20) { snprintf(out, cap, "%s", NUM_ONES[n]); return; }
  if (n < 60) {
    if (n % 10 == 0) snprintf(out, cap, "%s", NUM_TENS[n / 10]);
    else snprintf(out, cap, "%s-%s", NUM_TENS[n / 10], NUM_ONES[n % 10]);
    return;
  }
  snprintf(out, cap, "%d", n);   // days past fifty-nine are numerals
}

static void unitWords(int n, const char *unit, char *out, size_t cap) {
  char num[24];
  numberWords(n, num, sizeof(num));
  snprintf(out, cap, "%s %s%s", num, unit, n == 1 ? "" : "s");
}

static void durationWords(uint32_t seconds, char *out, size_t cap) {
  char a[40], b[40];
  if (seconds < 60) {
    unitWords((int)seconds, "second", out, cap);
  } else if (seconds < 3600) {
    unitWords((int)(seconds / 60), "minute", out, cap);
  } else if (seconds < 86400) {
    const int h = (int)(seconds / 3600), m = (int)((seconds % 3600) / 60);
    unitWords(h, "hour", a, sizeof(a));
    if (m == 0) { snprintf(out, cap, "%s", a); }
    else { unitWords(m, "minute", b, sizeof(b)); snprintf(out, cap, "%s, %s", a, b); }
  } else {
    const int d = (int)(seconds / 86400), h = (int)((seconds % 86400) / 3600);
    unitWords(d, "day", a, sizeof(a));
    if (h == 0) { snprintf(out, cap, "%s", a); }
    else { unitWords(h, "hour", b, sizeof(b)); snprintf(out, cap, "%s, %s", a, b); }
  }
  if (out[0] >= 'a' && out[0] <= 'z') out[0] = (char)(out[0] - 'a' + 'A');
}
