#pragma once

#include <stdint.h>
#include <stdio.h>
#include <string.h>

// Reaction lines. Every string here is verbatim from docs/POTATO_VOICE.md
// (§3, §11, §12). Do not improve them; reread §1 of the voice doc first.
//
// A pool plays out in full, in an order the potato's seed sets, before any
// line comes back (§3). The cursor is persisted from the sketch, so a
// reboot does not reopen with the same seed-picked line. Single lines have
// no pool.

enum PoolId : uint8_t {
  POOL_PICKUP = 0,
  POOL_PICKUP_RARE,   // never walked; the seed picks one line for keeps
  POOL_MORNING,
  POOL_RESTLESS,
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
    "Noted.",
    "I was settled.",
    "There was no notice.",
    "Very well.",
    "I had a position.",
    "This wasn't scheduled.",
    "The world was adequate.",
    "The Hands have intervened.",
    "One moment.",
};

// The seed gives each potato one of these as its own signature, said every
// tenth eligible pick-up and no oftener. The ration is what makes it land.
static const char *const LINES_PICKUP_RARE[] = {
    "Careful. I'm not insured.",
    "I assume there is paperwork.",
    "This is how incidents begin.",
    "Management again.",
};

// First pick-up of the day (needs the clock; without it, the core pool).
static const char *const LINES_MORNING[] = {
    "Morning.",
    "A new day. Apparently.",
    "The Hands are operational.",
};

// The fourth spoken session in one day, and on.
static const char *const LINES_RESTLESS[] = {
    "Again.",
    "You are restless today.",
    "Another intervention.",
};

static const char *const LINES_PUTDOWN[] = {
    "Here is fine.",
    "This is not where I was.",
    "Acceptable.",
    "Closer to outside. Interesting.",
    "This will do.",
    "I preferred the other place.",
    "The world has changed.",
    "I'll note the view.",
    "Accepted provisionally.",
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
    "I noticed.",
    "Once is enough.",
    "Contact noted.",
    "I was already awake.",
    "The Hands are testing something.",
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
    POOL_OF(LINES_PICKUP_RARE),
    POOL_OF(LINES_MORNING),
    POOL_OF(LINES_RESTLESS),
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

#define POOL_MAX_N 16

static uint32_t poolSeed = 0;             // from NVS; the server's seed once registered
static uint16_t poolPicks[POOL_COUNT];    // lifetime picks per pool; persisted by the sketch
static uint16_t pickupCount = 0;          // eligible pick-ups ever; persisted by the sketch
static bool poolStateDirty = false;       // the sketch saves when set

static uint32_t poolMix(uint32_t a, uint32_t b) {
  uint32_t h = poolSeed ^ (0x9E3779B9u * (a + 1u)) ^ (0xC2B2AE35u * (b + 1u));
  h ^= h >> 16; h *= 0x85EBCA6Bu; h ^= h >> 13; h *= 0xC2B2AE35u; h ^= h >> 16;
  return h;
}

// One cycle of a pool is 0..n-1 in a seeded order, new order each cycle.
static void poolOrderRaw(PoolId id, uint16_t cycle, uint8_t n, uint8_t *order) {
  for (uint8_t i = 0; i < n; ++i) order[i] = i;
  for (uint8_t i = (uint8_t)(n - 1); i > 0; --i) {
    const uint8_t j = (uint8_t)(poolMix(((uint32_t)id << 8) | i, cycle) % (uint32_t)(i + 1));
    const uint8_t t = order[i]; order[i] = order[j]; order[j] = t;
  }
}

// A new cycle never opens with the line the old one closed on. The guard
// only ever swaps slots 0 and 1, so a cycle's closing line is always its
// raw order's last — the check needs no recursion.
static void poolOrder(PoolId id, uint16_t cycle, uint8_t n, uint8_t *order) {
  poolOrderRaw(id, cycle, n, order);
  if (cycle > 0 && n > 2) {
    uint8_t prev[POOL_MAX_N];
    poolOrderRaw(id, (uint16_t)(cycle - 1), n, prev);
    if (order[0] == prev[n - 1]) { const uint8_t t = order[0]; order[0] = order[1]; order[1] = t; }
  }
}

// Walk the pool as a bag: the whole pool before any line returns, never the
// same line twice running, and the cursor picks up where the last boot left
// off. Two-line pools strictly alternate, the seed picking the opener.
static const char *pickLine(PoolId id) {
  const Pool &p = POOLS[id];
  if (p.n == 1) return p.lines[0];
  const uint16_t k = poolPicks[id]++;
  poolStateDirty = true;
  if (p.n == 2) return p.lines[(poolMix(id, 0) + k) % 2u];
  uint8_t order[POOL_MAX_N];
  poolOrder(id, (uint16_t)(k / p.n), p.n, order);
  return p.lines[order[k % p.n]];
}

// §3: every tenth eligible pick-up is this potato's own rare line — the
// seed picks which one, for keeps. The sketch counts the pick-ups.
static const uint8_t RARE_EVERY_N = 10;
static const char *rareSignatureLine() {
  return LINES_PICKUP_RARE[poolMix(0x5157, 0xE1) %
                           (uint32_t)(sizeof(LINES_PICKUP_RARE) / sizeof(LINES_PICKUP_RARE[0]))];
}
static uint8_t rareSignaturePhase() { return (uint8_t)(poolMix(0x9A5E, 0xE2) % RARE_EVERY_N); }

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
