// potato — a citizen of the Net. It lives on the panel and keeps a File on you.
//
// Forked from creature (~/Developer/ESP32-S3/firmware/creature). The body is
// now a potato: an ellipse perturbed by three low-frequency bumps, sampled to
// a polygon each frame and filled with a sub-pixel scanline rasterizer. Two
// dark eyes. No mouth. Pure black to the edge. The breathing, lean, slosh and
// gaze springs, the handling detector, and the power policy are the creature's.
//
// Two things from that work are load-bearing and easy to undo by accident:
//
//   Blit rects must be even on all four edges. The CO5300 addresses columns in
//   pairs and Arduino_CO5300 passes the rect straight to CASET, so an odd edge
//   shears the panel into vertical streaks. Telemetry prints ODD! if it recurs.
//
//   Handling is sustained motion above a measured noise floor, not a threshold
//   crossing. A keystroke on the desk is an impulse; a hand is 250ms.
//
// Board: Waveshare ESP32-S3-Touch-AMOLED-1.8, V2 (CO5300 + CST820).
// Build with `make -C firmware build`. Monitor with dtr=off,rts=off — the
// S3's USB CDC is the chip itself and either line asserted parks it.

#include "version.h"

#include <Arduino.h>
#include <Wire.h>
#include <math.h>
#include <string.h>
#include "esp_heap_caps.h"
#include "esp_random.h"
#include "HWCDC.h"
#include "Arduino_GFX_Library.h"
#include <Adafruit_XCA9554.h>
#include "SensorQMI8658.hpp"
#define XPOWERS_CHIP_AXP2101
#include "XPowersLib.h"
#include <Preferences.h>
#include <time.h>
#include "board_pins.h"
#include "sleep.h"
#include "spring.h"
#include "temperament.h"
#include "render_rect.h"
#include "potato_shape.h"
#include "raster.h"
#include "pools.h"
#include "events.h"
#include "ui_text.h"
#include "net.h"

HWCDC USBSerial;

static const Temperament T = POTATO;
static const PotatoShape SHAPE = RUSSET;

// ---------------------------------------------------------------- tuning ---

#define QSPI_HZ 40000000   // 40MHz is Arduino_GFX's default and known good here

// Where the potato lives. The lower third of the panel is reserved for the
// line and the buttons, so the body sits high. The body blit is clamped
// above TEXT_Y regardless; at rest it clears it by a wide margin.
static const float HOME_X = LCD_WIDTH * 0.5f;
static const float HOME_Y = 146.0f;   // about a third of the way down
static const float BASE_R = (RUSSET.rx + RUSSET.ry) * 0.5f;   // gaze scale

static const float FREEFALL_G = 0.35f;
static const float IMPACT_G   = 2.20f;

// Handling is detected as motion ABOVE the resting noise floor, not above a
// fixed value. The QMI8658 reports tens of degrees per second of bias and noise
// while perfectly still, which is enough to clear any fixed threshold worth
// using — so the floor is measured continuously and subtracted. Hysteresis
// keeps it from chattering at the boundary.
static const float HANDLE_ON  = 0.050f;
static const float HANDLE_OFF = 0.022f;
static const float HANDLE_MIN_S = 0.25f;

// Sloshing comes from being shoved, not from being rotated. The potato keeps
// itself level with gravity, so it is never actually tipped relative to down.
// This scales the sideways squash by lateral acceleration.
static const float SLOSH_PER_G = 0.55f;
static const float SLOSH_MAX   = 0.20f;
static const float DRIFT_PX    = 14.0f;

// Below this much in-plane gravity, "down" is not meaningfully on the screen
// plane and the lean angle is amplified sensor noise. Flat on a desk reads 0.11.
static const float FLAT_G = 0.18f;
static const float TILT_G = 0.55f;

static const float SHAPE_K = 220.0f, SHAPE_C = 16.0f;
static const float LEAN_K  = 180.0f, LEAN_C  = 14.0f;

static const uint32_t FRAME_US = 16667;  // 60fps cap; spare time is battery
static const uint32_t IDLE_FRAME_US = 30000;  // 33Hz while the panel is off

// Power and burn-in. With a cell attached, USB is not the power switch: left
// alone this would sit at full brightness drawing a bright static shape until
// the battery died, which is both drain and a real ghosting risk on AMOLED.
static const float DIM_AFTER_S  = 45.0f;    // untouched this long: fade down
static const float DIM_RAMP_S   = 15.0f;
static const float DARK_AFTER_S = 150.0f;   // untouched this long: panel off
static const uint8_t BRIGHT_FULL = 180;
static const uint8_t BRIGHT_DIM  = 40;

// Face-down is the everyday off switch: a deliberate physical gesture, no UI.
// Flat and face-up reads az about -0.97, so face-down is strongly positive.
static const float FACEDOWN_Z = 0.72f;

// Slow wander so an always-on potato never sits on the same pixels. The two
// rates are deliberately incommensurate so the path does not close quickly.
static const float WANDER_PX = 8.0f;
static const float WANDER_RATE = 0.0045f;

static const float LONG_PRESS_S = 0.85f;
static const uint8_t CST820_ADDR = 0x15;

// Accelerometer to screen orientation, in quarter turns, 0..3. Screen +x is
// right, +y is down. Z is the screen normal and says nothing about lean, so it
// is deliberately unused. Calibrated on hardware: hold the board upright and
// read the calibration line on the serial monitor.
#define ACC_ROT 3

static inline void accToScreen(float ax, float ay, float *gx, float *gy) {
#if ACC_ROT == 0
  *gx = ax;  *gy = ay;
#elif ACC_ROT == 1
  *gx = ay;  *gy = -ax;
#elif ACC_ROT == 2
  *gx = -ax; *gy = -ay;
#else
  *gx = -ay; *gy = ax;
#endif
}

// ------------------------------------------------------------- hardware ---

Arduino_DataBus *bus = new Arduino_ESP32QSPI(
    LCD_CS, LCD_SCLK, LCD_SDIO0, LCD_SDIO1, LCD_SDIO2, LCD_SDIO3);

Arduino_CO5300 *gfx = new Arduino_CO5300(
    bus, GFX_NOT_DEFINED /* RST */, 0 /* rotation */,
    LCD_WIDTH, LCD_HEIGHT, 16, 0, 0, 0);

Adafruit_XCA9554 expander;
SensorQMI8658 qmi;
XPowersPMU power;

static void clearPanelBlack() {
  memset(win, 0, (size_t)MAX_RECT * MAX_RECT * sizeof(uint16_t));
  for (int y = 0; y < LCD_HEIGHT; y += MAX_RECT) {
    const int h = min(MAX_RECT, LCD_HEIGHT - y);
    for (int x = 0; x < LCD_WIDTH; x += MAX_RECT) {
      const int w = min(MAX_RECT, LCD_WIDTH - x);
      gfx->draw16bitRGBBitmap(x, y, win, w, h);
    }
  }
}

static bool readVbusGood(bool *present) {
  Wire.beginTransmission(AXP2101_SLAVE_ADDRESS);
  Wire.write((uint8_t)XPOWERS_AXP2101_STATUS1);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom((uint8_t)AXP2101_SLAVE_ADDRESS, (uint8_t)1) != 1) return false;
  *present = (Wire.read() & (1u << 5)) != 0;
  return true;
}

static bool readI2cRegister(uint8_t address, uint8_t reg, uint8_t *data, size_t count) {
  Wire.beginTransmission(address);
  Wire.write(reg);
  if (Wire.endTransmission(false) != 0) return false;
  if (Wire.requestFrom(address, count) != count) return false;
  for (size_t i = 0; i < count; ++i) data[i] = Wire.read();
  return true;
}

static bool probeTouch(uint8_t *chipId) {
  for (int attempt = 0; attempt < 5; ++attempt) {
    Wire.beginTransmission(CST820_ADDR);
    if (Wire.endTransmission() == 0) {
      if (!readI2cRegister(CST820_ADDR, 0xA7, chipId, 1)) *chipId = 0xFF;
      return true;
    }
    delay(50);
  }
  return false;
}

static bool readTouchPoint(int16_t *x, int16_t *y) {
  uint8_t data[7];
  if (!readI2cRegister(CST820_ADDR, 0x00, data, sizeof(data))) return false;
  const uint8_t points = data[2] & 0x0F;
  if (points != 1 || data[2] == 0xFF) return false;
  *x = (int16_t)(((data[3] & 0x0F) << 8) | data[4]);
  *y = (int16_t)(((data[5] & 0x0F) << 8) | data[6]);
  return true;
}

// ------------------------------------------------------------- behaviour ---

static inline float frand() { return (float)(esp_random() >> 8) / 16777216.0f; }
static inline float frange(float a, float b) { return a + (b - a) * frand(); }
static inline float clamp01(float x) { return fminf(fmaxf(x, 0.0f), 1.0f); }

static Spring sLean, sSx, sSy, sDrift, sGazeX, sGazeY, sPerk;

static float breathPhase = 0.0f;
static float blinkIn = 3.0f, blinkT = -1.0f;   // blinkT < 0 means eyes open
static float glanceIn = 8.0f;        // seconds until the next idle glance down
static uint32_t glanceUntilMs = 0;   // while set, the eyes are on the text band
static float glanceX = 0.0f;         // small sideways lean of a glance
static float gazeTX = 0.0f, gazeTY = 0.0f;

static float arousal = 0.0f;      // 0..1 stirred right now
static float habituation = 0.0f;  // 0..1 how used to being handled
static bool wasHandled = false;   // hysteresis state
static bool prevHandled = false;  // for the rising edge
static float handledFor = 0.0f;   // seconds continuously above the line
static float motionFloor = 0.0f;  // resting noise floor, seeded during settling
static float gvX = 0.0f, gvY = 0.0f;  // low-passed gravity, screen frame

static float idleFor = 0.0f;      // seconds since last handled
static float sleepT = 0.0f;       // 0 awake, 1 fully asleep face-down
static float wanderPhase = 0.0f;
static uint8_t curBright = 0;
static bool panelOn = true;
static uint32_t bootMs = 0;       // for the settling window

static Expression expression = EXPR_NEUTRAL;

static bool touchReady = false;
static bool touching = false;
static bool pressingBody = false, prevPressingBody = false;
static int16_t touchX = -1, touchY = -1;
static float touchFor = 0.0f, touchLostFor = 0.0f;
static bool longPressFired = false;
static float hitBX = HOME_X, hitBY = HOME_Y;
static float hitRX = RUSSET.rx, hitRY = RUSSET.ry, hitTheta = 0.0f;

static bool powerReady = false;
static bool vbusGood = false;
static bool vbusCandidate = false;
static uint8_t vbusCandidateCount = 0;
static uint8_t powerReadMisses = 0;
static uint32_t lastPowerPollMs = 0;

// ----------------------------------------------------------- the potato ---

static Preferences prefs;
static EventQueue events;

// What the line band shows: a reaction for ~8s, then the scene line returns.
static const float REACTION_S = 8.0f;
static char sceneLine[MAX_LINE] = "";
static char reactionLine[MAX_LINE] = "";
static uint32_t reactionUntilMs = 0;
static uint32_t blankUntilMs = 0;     // the drop: blank screen, one second
static bool blanked = false;

struct Battery { int pct; bool charging; bool vbus; bool present; int mv; };
static Battery battery = {-1, false, false, false, -1};
static int chargeCurrentMa = -1;      // AXP2101 constant-current setting, read once
static uint32_t lastBatteryPollMs = 0;
static bool battFullSaid = false;
static uint8_t battStage = 0;         // thresholds said this discharge: 30/20/10/5
static bool vbusStable = false;       // VBUS state after the 60 s debounce (§15)
static bool vbusStableCand = false;
static uint32_t vbusCandSinceMs = 0;

// Detector state. Durations are seconds held, not threshold crossings.
static float sinceHandledS = 0.0f;    // for the heartbeat and the alone lines
static uint8_t aloneStage = 0;

// The ration (§15). A handling session begins at the first pick-up and ends
// after 60 s of stillness; one line per session, at the start. Minor lines
// (pickup, putdown, tap, plug, unplug) share a 3-minute cooldown and a ~60%
// seeded roll; major lines bypass the budget.
static bool sessionActive = false;
static bool sessionSpoke = false;       // §15: one line per session; put-down is the fallback
static uint32_t sessionStartMs = 0, sessionLastActiveMs = 0;
static float sessionQuietS = 0.0f;
static uint8_t sessionLifts = 0;
static uint32_t lastSessionEndMs = 0;   // 0 = never
static uint32_t lastMinorLineMs = 0;
static bool minorLineEver = false;
static uint16_t speakDayKey = 0;        // local day of the last spoken pick-up; persisted
static uint8_t daySpeakCount = 0;       // spoken pick-up sessions that day; persisted
static bool wasHeld = false;            // for the physical put-down event edge
static float heldQuietS = 0.0f;

// The dark. Confirmed after 5 s face-down AND still; the episode is spoken and
// reported to the server only once it passes 60 s.
static float darkStillS = 0.0f, faceUpFor = 0.0f;
static bool inDark = false;             // the episode clock is running
static bool darkAnnounced = false;      // spoke "Dark." and posted facedown_start
static uint32_t darkStartMs = 0;
static uint8_t darkStage = 0;
static float invertedFor = 0.0f, uprightFor = 0.0f;
static bool inCeiling = false;
static bool ceilingSaid = false;        // said the 5-minute line
static uint32_t ceilingStartMs = 0;
static bool ceiling20Said = false;
static uint8_t shakePeaks = 0;
static uint32_t shakeFirstMs = 0, shakeRefractoryMs = 0;
static bool inPeak = false;
static float freefallFor = 0.0f;
static uint32_t dropArmedUntilMs = 0, dropRefractoryMs = 0;
static float movingS = 0.0f, movingGapS = 0.0f;
static bool inTransit = false;
static uint32_t transitStartMs = 0;
static int8_t pressedButton = -1;
static uint32_t alarmedUntilMs = 0;   // wider eyes after a drop or a shake
static uint32_t cardUntilMs = 0;      // the status card, long-press, 20 s
static bool cardTouch = false;        // the touch that dismissed the card

// The scene: what the Net last told us to show. Cached in NVS by the task.
static int sceneRev = 0;
static int fileUnread = 0;
static char netStatusLine[MAX_LINE] = "";
static char orientationNow[10] = "up";
static uint32_t heartbeatDueMs = 0;   // events trigger a heartbeat, debounced
static uint32_t lastSnapshotMs = 0;
struct ActiveRequest {
  bool active;
  char id[12];
  char check[24];
  float needS, satisfiedS;
  uint32_t expiresAt;
};
static ActiveRequest request = {false, "", "", 0.0f, 0.0f, 0};

static void say(const char *line, float seconds) {
  strncpy(reactionLine, line, MAX_LINE - 1);
  reactionLine[MAX_LINE - 1] = 0;
  reactionUntilMs = millis() + (uint32_t)(seconds * 1000.0f);
  glanceX = 0.0f;
  glanceUntilMs = millis() + 2400;   // it looks down at its own words
  USBSerial.printf("line: %s\n", line);
}

static void sayPool(PoolId id) { say(pickLine(id), REACTION_S); }

// Pool entries containing %s take the counted duration, in words.
static void sayCounted(PoolId id, uint32_t seconds) {
  const char *l = pickLine(id);
  const char *at = strstr(l, "%s");
  if (!at) { say(l, REACTION_S); return; }
  char words[48], buf[MAX_LINE];
  durationWords(seconds, words, sizeof(words));
  snprintf(buf, sizeof(buf), "%.*s%s%s", (int)(at - l), l, words, at + 2);
  say(buf, REACTION_S);
}

static void postEvent(EventType t, int32_t v = 0, const char *sv = nullptr) {
  {
    NetLock l;   // the net task reads the queue while draining
    events.push(millis(), t, v, sv);
  }
  const char *k = eventValueKey(t);
  if (k && sv) USBSerial.printf("event %s %s=%s (queued %u)\n", EVENT_NAMES[t], k, sv, events.count);
  else if (k) USBSerial.printf("event %s %s=%ld (queued %u)\n", EVENT_NAMES[t], k, (long)v, events.count);
  else USBSerial.printf("event %s (queued %u)\n", EVENT_NAMES[t], events.count);
  heartbeatDueMs = millis() + 1500;   // immediately after an event, once it settles
}

// Local clock, once the Net has given us one. -1 until then.
static int localHour() {
  const time_t now = time(nullptr);
  if (now < 1700000000) return -1;
  struct tm lt;
  localtime_r(&now, &lt);
  return lt.tm_hour;
}
static bool isNight() {
  const int h = localHour();
  return h >= 0 && (h >= 23 || h < 6);
}
// A small local day key for "first pick-up of the day". -1 until the Net
// has given us a clock.
static int localDayKey() {
  const time_t now = time(nullptr);
  if (now < 1700000000) return -1;
  struct tm lt;
  localtime_r(&now, &lt);
  return (lt.tm_year - 100) * 366 + lt.tm_yday;
}

static bool asleepNow = false;   // night sleep or the scene says asleep/dormant

static void refreshLine() {
  const bool reacting = reactionLine[0] && (int32_t)(millis() - reactionUntilMs) < 0;
  uiSetLine(reacting ? reactionLine
            : asleepNow ? ""
            : netStatusLine[0] ? netStatusLine
            : sceneLine[0] ? sceneLine : LINE_EYES);
}

// Night touch. The time variant is filled from the clock; with no clock it
// is skipped for the next variant in the pool.
static void sayNight() {
  const char *l = pickLine(POOL_NIGHT);
  const char *at = strstr(l, "%s");
  if (!at) { say(l, REACTION_S); return; }
  const int h = localHour();
  if (h < 0) { say(pickLine(POOL_NIGHT), REACTION_S); return; }   // never the same twice running
  char hw[12], buf[MAX_LINE];
  hour12Words(h, hw, sizeof(hw));
  snprintf(buf, sizeof(buf), "%.*s%s%s", (int)(at - l), l, hw, at + 2);
  say(buf, REACTION_S);
}

// The pick-up slot (§3): the day's first spoken pick-up in morning hours is
// morning; the fourth spoken session in one day is restless; every tenth
// eligible pick-up is this potato's own rare line; the rest walk the core
// pool. Without a clock, only the rare line and the core pool.
static void sayPickup() {
  const int day = localDayKey();
  if (day >= 0) {
    if ((uint16_t)day != speakDayKey) { speakDayKey = (uint16_t)day; daySpeakCount = 0; }
    ++daySpeakCount;
    poolStateDirty = true;
    const int h = localHour();
    if (daySpeakCount == 1 && h >= 4 && h < 12) { sayPool(POOL_MORNING); return; }
    if (daySpeakCount >= 4) { sayPool(POOL_RESTLESS); return; }
  }
  ++pickupCount;
  poolStateDirty = true;
  if (pickupCount % RARE_EVERY_N == rareSignaturePhase()) { say(rareSignatureLine(), REACTION_S); return; }
  sayPool(POOL_PICKUP);
}

static void upperInto(char *dst, size_t cap, const char *src) {
  size_t i = 0;
  for (; src[i] && i < cap - 1; ++i) {
    const char c = src[i];
    dst[i] = c == '_' ? ' ' : (c >= 'a' && c <= 'z' ? (char)(c - 32) : c);
  }
  dst[i] = 0;
}

// The status card: plain and bureaucratic, 20 s, no quips. The Hands asked
// a direct question. A tap dismisses it early.
static void showStatusCard() {
  static char l[CARD_LINES][48];
  char a[32], b[32];
  if (identity.registered) {
    upperInto(a, sizeof(a), identity.name);
    upperInto(b, sizeof(b), identity.variety);
    snprintf(l[0], 48, "%s #%s / %s", a, identity.potatoId, b);
    snprintf(l[1], 48, "Claim %s", identity.claim);
  } else {
    snprintf(l[0], 48, "UNREGISTERED");
    snprintf(l[1], 48, "No claim code yet");
  }
  if (battery.present && battery.pct >= 0) {
    const char *state = !vbusGood ? "on battery"
                        : (battery.pct >= 100 || !battery.charging) ? "full" : "charging";
    snprintf(l[2], 48, "Battery %d%% / %s", battery.pct, state);
  } else {
    snprintf(l[2], 48, "Battery unknown / %s", vbusGood ? "on power" : "on battery");
  }
  const time_t now = time(nullptr);
  if (now > 1700000000) {
    struct tm lt, ut;
    localtime_r(&now, &lt);
    gmtime_r(&now, &ut);
    const int h12 = lt.tm_hour % 12 == 0 ? 12 : lt.tm_hour % 12;
    snprintf(l[3], 48, "%d:%02d %s here / %02d:%02d UTC", h12, lt.tm_min,
             lt.tm_hour < 12 ? "AM" : "PM", ut.tm_hour, ut.tm_min);
  } else {
    snprintf(l[3], 48, "Time unknown");
  }
  bool online, ok;
  { NetLock lk; online = net.online; ok = net.lastHttpOk; }
  snprintf(l[4], 48, "%s", !online ? "Wi-Fi: none" : ok ? "Net: connected" : "Net: unreachable");
  const char *lines[CARD_LINES] = {l[0], l[1], l[2], l[3], l[4]};
  uiSetCard(lines, CARD_LINES);
  cardUntilMs = millis() + 20000;
  USBSerial.printf("card: \"%s\" | \"%s\" | \"%s\" | \"%s\" | \"%s\"\n", l[0], l[1], l[2], l[3], l[4]);
}

static void showClaim(float seconds) {
  char buf[MAX_LINE];
  if (identity.registered && identity.claim[0]) {
    snprintf(buf, sizeof(buf), "Claim code %s. It opens the File.", identity.claim);
  } else {
    snprintf(buf, sizeof(buf), "No claim code yet. The Net hasn't answered.");
  }
  say(buf, seconds);
}

// Render what the Net sent. The device renders what it can: expression,
// line, choices, file_unread (the glance), request (checked by the IMU or a
// DONE button). Cues: throat_clear has no audio path yet and is skipped;
// incident widens the eyes for a moment. The bulletin is the e-paper's.
static void applySceneJson(const char *json) {
  static SceneData sd;
  if (!parseScene(json, sd)) { USBSerial.println("scene: bad json"); return; }
  sceneRev = sd.rev;
  expression = sd.expression;
  const bool lineChanged = strncmp(sceneLine, sd.line, MAX_LINE - 1) != 0;
  strncpy(sceneLine, sd.line, MAX_LINE - 1);
  sceneLine[MAX_LINE - 1] = 0;
  if (lineChanged && sceneLine[0]) {
    glanceX = 0.0f;
    glanceUntilMs = millis() + 2400;   // news from the Net earns a look down
  }
  fileUnread = sd.fileUnread;

  Choice choices[MAX_CHOICES];
  uint8_t n = sd.nChoices;
  for (uint8_t i = 0; i < n; ++i) choices[i] = sd.choices[i];

  request.active = sd.hasRequest;
  if (sd.hasRequest) {
    strncpy(request.id, sd.requestId, sizeof(request.id) - 1);
    strncpy(request.check, sd.requestCheck, sizeof(request.check) - 1);
    request.needS = sd.requestForS;
    request.satisfiedS = 0.0f;
    request.expiresAt = sd.requestExpiresAt;
    if (!sceneLine[0]) strncpy(sceneLine, sd.requestText, MAX_LINE - 1);
    if (!strcmp(request.check, "tap") && n < MAX_CHOICES) {
      strncpy(choices[n].id, "__done", sizeof(choices[n].id) - 1);
      strncpy(choices[n].label, "DONE", sizeof(choices[n].label) - 1);
      ++n;
    }
  }
  uiSetChoices(choices, n);

  if (!strcmp(sd.cue, "throat_clear")) USBSerial.println("scene: cue throat_clear — no audio path yet, skipped");
  else if (!strcmp(sd.cue, "incident")) alarmedUntilMs = millis() + 4000;

  { NetLock l; net.revSeen = sceneRev; }
  USBSerial.printf("scene: rev %d %s \"%s\" choices %u unread %d request %s\n", sceneRev,
                   sd.expressionName, sceneLine, (unsigned)n, fileUnread,
                   request.active ? request.check : "none");
}

// Loop side of the Net: pick up what the task left, once a frame.
static void netPoll(uint32_t tNow) {
  static char json[SCENE_JSON_CAP];
  bool sceneFresh = false, claimFresh = false, wifiLost = false, wifiBack = false;
  bool dormant = false, statusFresh = false;
  uint32_t backDur = 0, dormDur = 0;
  {
    NetLock l;
    if (net.sceneFresh) { memcpy(json, net.sceneJson, SCENE_JSON_CAP); net.sceneFresh = false; sceneFresh = true; }
    claimFresh = net.claimFresh; net.claimFresh = false;
    wifiLost = net.wifiLost; net.wifiLost = false;
    wifiBack = net.wifiBack; net.wifiBack = false; backDur = net.wifiBackDurS;
    dormant = net.dormantFresh; net.dormantFresh = false; dormDur = net.dormantDurS;
    if (net.statusLineFresh) {
      strncpy(netStatusLine, net.statusLine, MAX_LINE - 1);
      net.statusLineFresh = false;
      statusFresh = true;
    }
  }
  if (sceneFresh) applySceneJson(json);
  if (claimFresh) {
    if (identity.seed) poolSeed = identity.seed;
    showClaim(30.0f);
    USBSerial.printf("line: claim code shown for 30s (seed now %08lx)\n", (unsigned long)poolSeed);
  }
  if (wifiLost) say(LINE_NET_LOST, REACTION_S);
  if (wifiBack) { say(LINE_NET_BACK, REACTION_S); postEvent(EV_WIFI_RESTORE, (int32_t)backDur); }
  if (dormant) {
    say(dormDur >= 3 * 86400 ? LINE_DORMANT_3D : pickLine(POOL_DORMANT_WAKE), REACTION_S);
    postEvent(EV_DORMANT_RESUME, (int32_t)dormDur);
  }
  if (statusFresh) USBSerial.printf("net status line: \"%s\"\n", netStatusLine);

  // An update is installed in the other slot: reboot at a quiet moment —
  // no Question on the buttons, no open request, nobody touching, and
  // battery at 30% or on VBUS. The line first, then six seconds, then restart.
  static uint32_t rebootAtMs = 0;
  if (ota.ready && !rebootAtMs) {
    const bool quiet = uiChoiceCount == 0 && !request.active && !touching && !uiCardActive() &&
                       (vbusGood || battery.pct >= 30);
    if (quiet) {
      say(LINE_UPDATED, 8.0f);
      rebootAtMs = tNow + 6000;
      USBSerial.printf("ota: quiet moment — rebooting into %s in 6 s\n", ota.version);
    }
  }
  if (rebootAtMs && (int32_t)(tNow - rebootAtMs) >= 0) {
    USBSerial.println("ota: restart");
    USBSerial.flush();
    delay(50);
    ESP.restart();
  }

  if (heartbeatDueMs && (int32_t)(tNow - heartbeatDueMs) >= 0) {
    heartbeatDueMs = 0;
    netRequestHeartbeat();
  }
  if (tNow - lastSnapshotMs >= 1000) {
    lastSnapshotMs = tNow;
    netUpdateSnapshot(battery.pct, battery.charging, battery.vbus, orientationNow,
                      (uint32_t)sinceHandledS);
  }
}

static void choose(const Choice &c) {
  if (!strcmp(c.id, "__done") && request.active) {
    postEvent(EV_REQUEST_DONE, 0, request.id);
    request.active = false;
    uiSetChoices(nullptr, 0);
    return;
  }
  USBSerial.printf("choice id=%s label=\"%s\" rev=%d\n", c.id, c.label, sceneRev);
  if (identity.registered) netSendChoice(sceneRev, c.id);
}

// Seeded RNG for the ration, so a given potato's "about six in ten" is
// consistent from run to run. xorshift32 off the identity seed.
static uint32_t rngState = 0;
static inline float seededRoll() {
  if (rngState == 0) rngState = poolSeed ? poolSeed : 0xA5A5A5A5u;
  rngState ^= rngState << 13; rngState ^= rngState >> 17; rngState ^= rngState << 5;
  return (float)(rngState & 0xFFFFFFu) / 16777216.0f;
}

// Minor lines share a 3-minute cooldown and speak about six times in ten.
// Returns true and consumes the budget when a minor line may be spoken now.
static const uint32_t MINOR_COOLDOWN_MS = 180000;
static bool minorLineAllowed(uint32_t nowMs) {
  if (minorLineEver && (int32_t)(nowMs - lastMinorLineMs) < (int32_t)MINOR_COOLDOWN_MS) return false;
  if (seededRoll() >= 0.60f) return false;
  lastMinorLineMs = nowMs;
  minorLineEver = true;
  return true;
}

// The pool cursors survive reboots in NVS: without this, every boot (an
// upload, a dormancy) reopened with the same seed-picked line. A few bytes,
// written only when a line is spoken — a handful of times a day.
struct PoolNvs {
  uint16_t picks[POOL_COUNT];
  uint16_t pickups;
  uint16_t day;
  uint8_t spoken;
};
static void poolStateLoad() {
  PoolNvs s;
  if (prefs.getBytes("pools", &s, sizeof(s)) == sizeof(s)) {
    memcpy(poolPicks, s.picks, sizeof(poolPicks));
    pickupCount = s.pickups;
    speakDayKey = s.day;
    daySpeakCount = s.spoken;
  }
}
static void poolStateSave() {
  PoolNvs s;
  memcpy(s.picks, poolPicks, sizeof(s.picks));
  s.pickups = pickupCount;
  s.day = speakDayKey;
  s.spoken = daySpeakCount;
  prefs.putBytes("pools", &s, sizeof(s));
  poolStateDirty = false;
}

// AXP2101 constant-current register code -> mA (datasheet: 0..8 in 25 mA
// steps to 200 mA, then 100 mA steps to 1000 mA).
static inline int chgCurMa(uint8_t code) {
  return code <= 8 ? code * 25 : 200 + (code - 8) * 100;
}

// Eyelid coverage over a blink: shut fast, open a little slower.
static float blinkCurve(float t) {
  if (t < 0.0f || t > 1.0f) return 0.0f;
  return (t < 0.38f) ? (t / 0.38f) : (1.0f - (t - 0.38f) / 0.62f);
}

static void excite(float amount) {
  const float gain = 1.0f - habituation * T.habituationFloor;
  arousal += amount * T.reactionGain * gain;
  if (arousal > 1.0f) arousal = 1.0f;
  habituation += T.habituationGain * gain;
  if (habituation > 1.0f) habituation = 1.0f;
}

// ------------------------------------------------------------------ power ---
// Both polls live out here because the doze runs them too: a potato that
// sleeps through the night still has to notice the Hands plugging it in, and
// its fifteen-minute heartbeat has to carry a battery reading that is not
// eight hours old.

// The PMU answers "external VBUS is good" even for charge-only adapters.
// Require two consecutive changed samples so one I2C miss cannot switch the
// power policy. If the PMU is absent, HWCDC still detects a computer host.
// Self-rate-limiting at 1 Hz, so callers may call it as often as they like.
static void vbusPoll(uint32_t nowMs) {
  if (nowMs - lastPowerPollMs < 1000) return;
  lastPowerPollMs = nowMs;
  bool sample = false;
  bool sampleValid = true;
  if (powerReady) sampleValid = readVbusGood(&sample);
  else sample = USBSerial.isPlugged();
  if (!sampleValid) {
    if (powerReadMisses < 3) ++powerReadMisses;
    if (powerReadMisses >= 3) {
      sample = USBSerial.isPlugged();
      sampleValid = true;
      USBSerial.println("power: AXP2101 reads missed — using USB-host fallback");
    }
  } else {
    powerReadMisses = 0;
  }
  if (!sampleValid) return;
  if (sample == vbusCandidate) {
    if (vbusCandidateCount < 2) ++vbusCandidateCount;
  } else {
    vbusCandidate = sample;
    vbusCandidateCount = 1;
  }
  if (vbusCandidateCount >= 2 && vbusGood != vbusCandidate) {
    vbusGood = vbusCandidate;
    USBSerial.printf("power: external VBUS %s\n", vbusGood ? "present" : "absent");
  }
}

// Battery, every 5 s. The thresholds are downward crossings only, once per
// discharge, and — because vbusStable is false only after 60 s off power —
// never on a cable blip (tasks/lessons.md). Major lines: they bypass the
// minor budget.
static void batteryPoll(uint32_t nowMs) {
  if (!powerReady || nowMs - lastBatteryPollMs < 5000) return;
  lastBatteryPollMs = nowMs;
  battery.present = power.isBatteryConnect();
  battery.pct = battery.present ? power.getBatteryPercent() : -1;
  battery.mv = battery.present ? (int)power.getBattVoltage() : -1;
  battery.charging = power.isCharging();
  battery.vbus = power.isVbusIn();
  if (!battery.present || battery.pct < 0) return;
  if (vbusStable) {
    if (!battFullSaid && battery.pct >= 100) { battFullSaid = true; say(LINE_FULL, REACTION_S); }
    return;
  }
  static const int BATT_T[4] = {30, 20, 10, 5};
  static const char *const BATT_L[4] = {LINE_BATT_30, LINE_BATT_20, LINE_BATT_10, LINE_BATT_5};
  uint8_t stage = battStage;
  while (stage < 4 && battery.pct <= BATT_T[stage]) ++stage;
  if (stage != battStage) {
    battStage = stage;
    say(BATT_L[stage - 1], REACTION_S);
    postEvent(EV_BATTERY_LOW, battery.pct);
  }
}

// ------------------------------------------------------------------ setup ---

// What the boot bus looked like, kept so 'i' can answer "did recovery fire?"
// hours later. Opening this board's port reboots it (see tasks/lessons.md),
// so a boot log is not always there to re-read.
static int  i2cBootClocks = -1;      // -1 = bus was already clear, else 0..9
static bool i2cBootFreed  = true;

// One wording for the boot line and the 'i' dump, so they cannot drift.
static void i2cReport() {
  if (i2cBootClocks < 0) {
    USBSerial.println("i2c: bus clear at boot");
  } else {
    USBSerial.printf("i2c: SDA was held low at boot — clocked %d, now %s\n",
                     i2cBootClocks, i2cBootFreed ? "released" : "STILL LOW");
  }
}

// I2C bus recovery. A reset that lands mid-transaction (USB re-enumeration
// after a flash, a re-plug) can leave a slave holding SDA low, and every
// probe afterwards fails: one boot in ten came up with no expander, no
// touch and no PMU. Clock SCL until the slave releases SDA, then STOP.
//
// Both pins idle high before either driver is enabled. pinMode(OUTPUT) hands
// the pad whatever is already in the output latch, and that latch is LOW out
// of reset, so enabling SCL straight away puts a stray low pulse on the bus.
// That pulse is a free clock: it can release a held SDA before the sample
// below, and then a boot that genuinely needed recovery reports "bus clear"
// and the fault stays invisible. Setting the latch needs the pin registered
// first — core 3.x digitalWrite ignores a pin that no pinMode has claimed
// (esp32-hal-gpio.c, the perimanGetPinBus guard) — and pinMode never touches
// the latch, so INPUT_PULLUP -> digitalWrite -> OUTPUT is glitch-free.
static void i2cBusRecover() {
  pinMode(IIC_SDA, INPUT_PULLUP);
  pinMode(IIC_SCL, INPUT_PULLUP);   // claim the pin so the write below lands
  digitalWrite(IIC_SCL, HIGH);
  pinMode(IIC_SCL, OUTPUT);
  delayMicroseconds(5);
  if (digitalRead(IIC_SDA) == LOW) {
    int clocks = 0;
    while (digitalRead(IIC_SDA) == LOW && clocks < 9) {
      digitalWrite(IIC_SCL, LOW);
      delayMicroseconds(5);
      digitalWrite(IIC_SCL, HIGH);
      delayMicroseconds(5);
      ++clocks;
    }
    // STOP: SDA low -> high while SCL is high. Open-drain, so releasing the
    // line lets the pull-ups raise it instead of driving it into a slave that
    // is still pulling down. The latch is LOW out of reset, so enabling the
    // driver pulls SDA down — which is the first step of the STOP anyway.
    pinMode(IIC_SDA, OUTPUT_OPEN_DRAIN | PULLUP);
    digitalWrite(IIC_SDA, LOW);
    delayMicroseconds(5);
    digitalWrite(IIC_SCL, HIGH);
    delayMicroseconds(5);
    digitalWrite(IIC_SDA, HIGH);
    delayMicroseconds(5);
    pinMode(IIC_SDA, INPUT_PULLUP);
    delayMicroseconds(5);
    i2cBootClocks = clocks;
    i2cBootFreed = digitalRead(IIC_SDA) == HIGH;
  }
  pinMode(IIC_SCL, INPUT_PULLUP);   // hand the pins to Wire
  i2cReport();
}

// PMU bring-up. Called at boot and again from the loop if the PMU was not
// found, so a flaky boot heals instead of staying blind all day.
static bool pmuSetup(const char *when) {
  if (!power.begin(Wire, AXP2101_SLAVE_ADDRESS, IIC_SDA, IIC_SCL)) return false;
  powerReady = true;
  if (!readVbusGood(&vbusGood)) vbusGood = USBSerial.isPlugged();
  vbusCandidate = vbusGood;
  USBSerial.printf("AXP2101 ready (%s): external power %s\n", when, vbusGood ? "present" : "absent");
  power.enableBattDetection();
  power.enableBattVoltageMeasure();
  power.enableVbusVoltageMeasure();
  power.enableSystemVoltageMeasure();
  // The cell is a 3.7 V / 400 mAh / 1.48 Wh Li-ion pouch. 150 mA is 0.375C
  // (under 0.5C); do not raise this without a different cell. Target 4.20 V.
  power.setChargerConstantCurr(XPOWERS_AXP2101_CHG_CUR_150MA);
  chargeCurrentMa = chgCurMa(power.getChargerConstantCurr());
  if (power.getChargeTargetVoltage() != XPOWERS_AXP2101_CHG_VOL_4V2) {
    power.setChargeTargetVoltage(XPOWERS_AXP2101_CHG_VOL_4V2);
    USBSerial.println("power: charge target voltage was not 4.20 V — set to 4.20 V");
  }
  static const char *const CHG_VOL[] = {"?", "4.00", "4.10", "4.20", "4.35", "4.40"};
  const uint8_t vol = power.getChargeTargetVoltage();
  const int pre = (int)power.getPrechargeCurr();          // 25 mA steps
  const int term = (int)power.getChargerTerminationCurr(); // 25 mA steps
  USBSerial.printf("power: charge current set to %d mA; target %s V; precharge %d mA, "
                   "termination %d mA (defaults, reported only)\n",
                   chargeCurrentMa, vol < 6 ? CHG_VOL[vol] : "?", pre * 25, term * 25);
  return true;
}

static bool touchSetup(const char *when) {
  uint8_t chipId = 0xFF;
  if (!probeTouch(&chipId)) return false;
  touchReady = true;
  USBSerial.printf("touch ready at 0x%02x (%s): chip id 0x%02x\n", CST820_ADDR, when, chipId);
  return true;
}

static uint32_t lastReprobeMs = 0;

// ------------------------------------------------------------------- doze ---
// State and the entry gate. The run loop itself is further down, after the
// frame state it has to put back on the way out.

static bool dozing = false;
static bool dozeForce = false;          // the 'S' key: doze now, on power or not
static uint32_t dozeCount = 0;          // how many times it has gone down
static uint32_t dozeTotalMs = 0;        // cumulative time spent down
static uint32_t dozeLastMs = 0;         // how long the last doze lasted
static uint32_t dozeBeats = 0, dozeBeatFails = 0;
static uint32_t dozeSlices = 0;         // light-sleep slices, all dozes
static uint32_t dozeSliceAskedMs = 0;   // what the last slice asked the timer for
static uint32_t dozeSliceSeenMs = 0;    // what millis() said had passed. If this
                                        // reads ~0 against a 120 ms ask, esp_timer
                                        // is not being advanced across light sleep
                                        // and every second-counter here is stalling.
static uint32_t dozeRejects = 0;        // esp_light_sleep_start() refusals
static uint32_t dozeWomGuards = 0;      // stale WoM latches cleared and slept through
static uint32_t dozeGpioSpurious = 0;   // GPIO wakes with nothing behind them
static uint32_t dozeI2cFaults = 0;      // sensor reads that got no answer
static WakeReason dozeLastWake = WAKE_NONE;
static uint32_t dozeLastWakeMs = 0;
static bool dozeImuIntArmed = false, dozeTouchIntArmed = false;
static bool dozeTouchWakeGivenUp = false;   // sticky across dozes once it misbehaves
static uint32_t dozeRetryAtMs = 0;          // after a sensor failure, do not thrash it
static const uint32_t DOZE_RETRY_MS = 300000;

// After a doze the accelerometer has just been reset and reconfigured. Its
// first samples are not a fall and not a shake; the impulse detectors stay
// out of the way until it has settled.
static uint32_t detectorHoldMs = 0;

// The left-alone ladder's thresholds. Out here rather than inside loop()
// because the doze has to fast-forward past the ones it slept through.
static const float ALONE_T_S[6] = {4 * 3600.0f, 8 * 3600.0f, 24 * 3600.0f,
                                   48 * 3600.0f, 72 * 3600.0f, 7 * 86400.0f};

// Why the potato did not go down, tallied per reason. Every `no` below is a
// string literal, so the pointer itself identifies the reason and nothing has
// to be copied or compared. This exists because the refusal is invisible where
// it matters: on battery there is no USB, so the 2 s "asleep" log goes nowhere,
// and the night of the 24th was lost to exactly that. Plugging the cable back
// in does not reset the board, so the tally survives a night to be read by 's'.
static const char *dozeWhyName[8] = {0};
static uint32_t dozeWhyCount[8] = {0};
static uint32_t dozeWhyTotal = 0;

// The high-water mark of idleFor while the panel was dark. Without it a tally
// of "not idle thirty minutes yet" is ambiguous: it reads the same whether the
// timer crept to 1799 and got interrupted, or never passed 60 because
// something kept resetting it. One number separates those.
static float dozeIdleMax = 0.0f;

static void dozeWhyTally(const char *no) {
  if (idleFor > dozeIdleMax) dozeIdleMax = idleFor;
  if (!no) return;
  ++dozeWhyTotal;
  for (int i = 0; i < 8; ++i) {
    if (dozeWhyName[i] == no) { ++dozeWhyCount[i]; return; }
    if (!dozeWhyName[i]) { dozeWhyName[i] = no; dozeWhyCount[i] = 1; return; }
  }
}

// Why the potato may or may not go down right now. `why` is filled with the
// first thing standing in the way, for the 's' dump. `record` tallies the
// refusal; the 's' dump passes false so that asking cannot change the answer.
static bool dozeAllowed(char *why, size_t cap, bool record) {
  const char *no = nullptr;
  char status[48];
  netStatusCopy(status, sizeof(status));
  // Never on power, and never on the raw bit: vbusGood is the 2-sample
  // debounce and vbusStable the 60-second one (voice doc §15), and both have
  // to agree the potato is on its own. That is deliberately stricter than
  // either — a cable that flickers cancels the doze at once, and a genuine
  // unplug waits out the minute before it counts.
  if (vbusGood || vbusStable) no = "on power";
  else if (panelOn) no = "panel is lit";
  else if (touching) no = "a finger on the glass";
  else if (sessionActive) no = "handling session open";
  // A request is a live invitation with a deadline and the IMU has to be
  // watching for it to be met. It cannot pin the potato awake for long: the
  // frame loop clears it at expires_at.
  else if (request.active) no = "an open request to verify";
  else if (uiCardActive()) no = "the card is up";
  else if (!strcmp(status, "portal")) no = "the portal is open";
  else if (dozeRetryAtMs && (int32_t)(millis() - dozeRetryAtMs) < 0) {
    no = "the sensor would not arm; waiting to try again";
  }
  else if (!(idleFor > DOZE_IDLE_S || (isNight() && idleFor > DOZE_NIGHT_IDLE_S))) {
    no = isNight() ? "not idle five minutes yet" : "not idle thirty minutes yet";
  }
  // Deliberately NOT reasons to stay up:
  //
  //   Unsent events, an unregistered potato, no Wi-Fi at all. Every one of
  //   those means the Net is out of reach, and a potato that stays awake
  //   waiting for an unreachable Net is exactly the potato that was dormant
  //   by 06:23. It sleeps and tries again in fifteen minutes.
  //
  //   A Question on the buttons. The Question window is ten hours wide
  //   (13:00-23:00 UTC) and this gate would cover all of it — the potato
  //   would never doze in daylight. Nothing is lost: the panel is dark, so
  //   the buttons are not visible, nobody can vote without picking it up,
  //   and picking it up wakes it in under a fifth of a second. The Hands
  //   absent at the close are the server's business, and it already votes
  //   for them by seed.
  //
  //   A staged update. It only ever reaches here still staged because the
  //   battery is under 30% and off power (netPoll reboots at any quieter
  //   moment than this one), and an update waiting for battery it does not
  //   have must not also stop the potato from saving that battery. It
  //   installs on the next wake that qualifies.
  if (why && cap) { strncpy(why, no ? no : "ready", cap - 1); why[cap - 1] = 0; }
  if (record) dozeWhyTally(no);
  return no == nullptr;
}

// The 's' key. Opening this board's port reboots it (tasks/lessons.md), so
// anything that only appears in a boot log is unreadable in practice: this
// has to answer "is it sleeping, why not, and what woke it last" on a device
// that has been running for a week.
static void dozeReport() {
  char why[48];
  const bool ready = dozeAllowed(why, sizeof(why), false);
  const int h = localHour();
  USBSerial.printf("doze: %s (%s) | idle %.0fs of %.0fs%s | vbus good %d stable %d\n",
                   dozing ? "DOWN" : ready ? "ready" : "up", why, idleFor,
                   isNight() ? DOZE_NIGHT_IDLE_S : DOZE_IDLE_S,
                   h < 0 ? " | no clock, night rule off" : isNight() ? " | night" : "",
                   vbusGood, vbusStable);
  USBSerial.printf("  policy: down at %.0fs idle or %.0fs between 23:00-06:00 local; "
                   "beat every %lus; slice %lums; WoM %dmg\n",
                   DOZE_IDLE_S, DOZE_NIGHT_IDLE_S, (unsigned long)(DOZE_BEAT_MS / 1000),
                   (unsigned long)(dozeImuIntArmed ? DOZE_SLICE_INT_MS : DOZE_SLICE_POLLED_MS),
                   POTATO_WOM_MG);
  USBSerial.printf("  wake: IMU %s | touch INT %s | timer always\n",
                   POTATO_IMU_INT_PIN < 0
                       ? "QMI8658 WoM latch read once per slice (no INT pin wired on this board)"
                       : dozeImuIntArmed ? "QMI8658 INT, hardware wake" : "QMI8658 INT configured but not armed",
                   dozeTouchWakeGivenUp ? "given up (kept firing with nothing behind it)"
                   : dozeTouchIntArmed  ? "armed"
                   : POTATO_TOUCH_WAKE  ? "not armed (was not idle high)"
                                        : "disabled at build time");
  USBSerial.printf("  last wake: %s%s | dozes %lu, %lu min down total, last %lu s\n",
                   wakeReasonName(dozeLastWake),
                   dozeLastWakeMs ? "" : " (none yet)",
                   (unsigned long)dozeCount, (unsigned long)(dozeTotalMs / 60000),
                   (unsigned long)(dozeLastMs / 1000));
  USBSerial.printf("  counters: slices %lu, beats %lu (%lu failed), sleep refused %lu, "
                   "stale WoM cleared %lu, spurious GPIO %lu, sensor no-answer %lu\n",
                   (unsigned long)dozeSlices, (unsigned long)dozeBeats,
                   (unsigned long)dozeBeatFails, (unsigned long)dozeRejects,
                   (unsigned long)dozeWomGuards, (unsigned long)dozeGpioSpurious,
                   (unsigned long)dozeI2cFaults);
  if (dozeWhyTotal) {
    USBSerial.printf("  refused %lu times:", (unsigned long)dozeWhyTotal);
    for (int i = 0; i < 8 && dozeWhyName[i]; ++i)
      USBSerial.printf(" [%s x%lu]", dozeWhyName[i], (unsigned long)dozeWhyCount[i]);
    USBSerial.printf(" | idle high-water %.0fs of %.0fs\n", dozeIdleMax, DOZE_IDLE_S);
  } else {
    USBSerial.println("  refused 0 times (the dark path has never asked)");
  }
  // The one number that says whether the clock survived the sleep. Asked and
  // seen should match within a millisecond or two. If seen is ~0, esp_timer is
  // not being advanced from the RTC on wake and every second-counter in this
  // firmware stalls while it dozes — the alone ladder, since_handled_s, the
  // fifteen-minute beat.
  if (dozeSliceAskedMs) {
    USBSerial.printf("  last slice: asked %lums, millis() saw %lums%s\n",
                     (unsigned long)dozeSliceAskedMs, (unsigned long)dozeSliceSeenMs,
                     dozeSliceSeenMs + 20 < dozeSliceAskedMs
                         ? "  <-- the clock is NOT tracking light sleep" : "");
  }
}

void setup() {
  USBSerial.begin(115200);
  USBSerial.setTxTimeoutMs(0);

  i2cBusRecover();
  Wire.begin(IIC_SDA, IIC_SCL);

  // Reset pulse for display and touch. Not required to light the panel, but it
  // makes cold starts deterministic. Three tries, 50 ms apart, like the rest.
  bool expanderOk = false;
  for (int attempt = 1; attempt <= 3 && !expanderOk; ++attempt) {
    expanderOk = expander.begin(IO_EXPANDER_ADDR);
    if (expanderOk) USBSerial.printf("XCA9554 ready at 0x20 (attempt %d)\n", attempt);
    else delay(50);
  }
  if (expanderOk) {
    for (uint8_t p = 0; p < 3; ++p) expander.pinMode(p, OUTPUT);
    for (uint8_t p = 0; p < 3; ++p) expander.digitalWrite(p, LOW);
    delay(20);
    for (uint8_t p = 0; p < 3; ++p) expander.digitalWrite(p, HIGH);
    delay(20);
  } else {
    USBSerial.println("XCA9554 not found at 0x20 after 3 attempts — continuing without reset pulse");
  }

  for (int attempt = 1; attempt <= 3 && !touchReady; ++attempt) {
    char when[16];
    snprintf(when, sizeof(when), "attempt %d", attempt);
    if (!touchSetup(when)) delay(50);
  }
  if (!touchReady) USBSerial.println("CST820 touch not found at 0x15 after 3 attempts — will re-probe every 60 s");

  for (int attempt = 1; attempt <= 3 && !powerReady; ++attempt) {
    char when[16];
    snprintf(when, sizeof(when), "attempt %d", attempt);
    if (!pmuSetup(when)) delay(50);
  }
  if (!powerReady) {
    // HWCDC sees a computer host without depending on DTR/RTS. It does not see
    // a charge-only adapter, so it is only a fallback when the PMU is missing.
    vbusGood = USBSerial.isPlugged();
    vbusCandidate = vbusGood;
    USBSerial.printf("AXP2101 not found after 3 attempts — USB-host fallback says %s; will re-probe every 60 s\n",
                     vbusGood ? "connected" : "disconnected");
  }

  if (!gfx->begin(QSPI_HZ)) USBSerial.println("gfx->begin() failed");
  gfx->fillScreen(0x0000);
  gfx->setBrightness(180);

  const size_t bytes = (size_t)MAX_RECT * MAX_RECT * sizeof(uint16_t);
  win = (uint16_t *)heap_caps_malloc(bytes, MALLOC_CAP_DMA | MALLOC_CAP_INTERNAL);
  if (win) {
    USBSerial.printf("blit buffer: %u bytes internal DMA\n", (unsigned)bytes);
  } else {
    win = (uint16_t *)ps_malloc(bytes);
    USBSerial.printf("blit buffer: %u bytes PSRAM (slower path)\n", (unsigned)bytes);
  }
  if (!win) {
    USBSerial.println("no buffer — is PSRAM enabled (OPI)?");
    while (true) delay(1000);
  }

  if (!qmi.begin(Wire, QMI8658_L_SLAVE_ADDRESS, IIC_SDA, IIC_SCL)) {
    USBSerial.println("QMI8658 not found — check I2C on 15/14");
    while (true) delay(1000);
  }
  // One wording for the rates, in sleep.h, because the doze's wake path has
  // to restore exactly these: the handling detector is calibrated against
  // them and a wake that came back at a different ODR would quietly change
  // what "being picked up" means.
  imuConfigureNormal(qmi);

  vbusStable = vbusGood;
  vbusStableCand = vbusGood;

  prefs.begin("potato", false);
  poolSeed = prefs.getUInt("seed", 0);
  if (poolSeed == 0) {
    poolSeed = esp_random() | 1u;
    prefs.putUInt("seed", poolSeed);
    USBSerial.printf("seed: %08lx (new, stored)\n", (unsigned long)poolSeed);
  } else {
    USBSerial.printf("seed: %08lx (NVS)\n", (unsigned long)poolSeed);
  }
  poolStateLoad();   // the bags pick up where the last boot left off

  netBegin(prefs, &events);
  if (identity.seed) poolSeed = identity.seed;   // the server's seed wins

  if (uiBegin(gfx)) {
    USBSerial.printf("text canvas: %dx%d at y=%d, PSRAM\n", LCD_WIDTH, TEXT_H, TEXT_Y);
  } else {
    USBSerial.println("text canvas: PSRAM alloc failed — no text");
  }

  sSx.x = 1.0f;
  sSy.x = 1.0f;
  blinkIn = frange(T.blinkMin, T.blinkMax);
  glanceIn = frange(T.glanceMin, T.glanceMax);

  bootMs = millis();
  USBSerial.printf("potato up. fw %s. russet, %dx%d. It has eyes.\n",
                   FW_VERSION, (int)SHAPE.rx, (int)SHAPE.ry);
  USBSerial.printf("doze: down after %.0fs idle, or %.0fs between 23:00-06:00 local; "
                   "beat every %lus; never on VBUS. 's' reports it, 'S' forces it.\n",
                   DOZE_IDLE_S, DOZE_NIGHT_IDLE_S, (unsigned long)(DOZE_BEAT_MS / 1000));
}

// Development-only: type a key in the serial monitor to exercise the same
// state and render paths as the physical triggers, without claiming to
// validate the sensors. Lower case only; 'h' lists them.
static void serialCommand(int c) {
  switch (c) {
    case 't': sayPool(POOL_TAP); postEvent(EV_TAP); break;
    case 'n': sayNight(); break;
    case 'p': sayPickup(); postEvent(EV_PICKUP); break;
    case 'd':
      blankUntilMs = millis() + 1000; blanked = false; alarmedUntilMs = millis() + 5000;
      sayPool(POOL_DROP); postEvent(EV_DROP);
      break;
    case 'k': sayCounted(POOL_DARK_RESTORED, 4 * 3600 + 45 * 60); postEvent(EV_FACEDOWN_END, 17100); break;
    case 'q': {
      static const Choice ketchup[3] = {
          {"heinz", "HEINZ"}, {"hunts", "HUNT'S"}, {"whatever", "WHATEVER'S THERE"}};
      strncpy(sceneLine, "Ketchup. Which would you least object to being served with?", MAX_LINE - 1);
      uiSetChoices(ketchup, 3);
      expression = EXPR_WAITING;
      USBSerial.println("scene: demo Question with three choices");
      break;
    }
    case 'x': sceneLine[0] = 0; uiSetChoices(nullptr, 0); expression = EXPR_NEUTRAL; break;
    case 'a': expression = EXPR_AGGRIEVED; break;
    case 'w': expression = EXPR_PLEASED; break;
    case 'z': expression = EXPR_ASLEEP; break;
    case 'v': expression = EXPR_WAITING; break;
    case '1': case '2': case '3': {
      const int b = c - '1';
      if (b < uiChoiceCount) { uiSetPressed(-1); choose(uiChoices[b]); }
      else USBSerial.println("no such button");
      break;
    }
    case 'c': showStatusCard(); break;
    case 'u': otaRequestCheck(); USBSerial.println("ota: check requested"); break;
    case 'X': USBSerial.println("restart requested"); USBSerial.flush(); delay(100); ESP.restart(); break;
    case 'b': netRequestHeartbeat(); USBSerial.println("heartbeat requested"); break;
    case 'i':
      USBSerial.printf("identity: %s, %s #%s %s claim %s seed %08lx | net %s hb %lu fail %lu rev %d | server %s tz %s | fw %s ota: %s\n",
                       identity.registered ? "registered" : "not registered", identity.name,
                       identity.potatoId, identity.variety, identity.claim, (unsigned long)poolSeed,
                       net.status, (unsigned long)net.heartbeats, (unsigned long)net.failures,
                       sceneRev, serverUrl, tzString, FW_VERSION, ota.lastResult);
      i2cReport();
      break;
    case 'W': netForgetWifi(); break;
    case 'R': netReregister(); break;
    case 's': dozeReport(); break;
    case 'S':
      dozeForce = true;
      USBSerial.println("doze: forced — the panel goes dark, the Net stands down, and it "
                        "light-sleeps for up to five minutes. On USB the CDC drops while "
                        "it sleeps: move the board to wake it, or re-plug.");
      break;
    case 'm':
      USBSerial.printf("ration: session %d lifts %u quiet %.0fs | since last end %lds | minor cooldown %lds%s | vbusStable %d cand %d\n",
                       sessionActive, sessionLifts, sessionQuietS,
                       lastSessionEndMs ? (long)((millis() - lastSessionEndMs) / 1000) : -1L,
                       minorLineEver ? (long)((millis() - lastMinorLineMs) / 1000) : -1L,
                       minorLineEver ? "" : " (none yet)", vbusStable, vbusStableCand);
      break;
    case 'e':
      USBSerial.printf("events queued %u dropped %lu:", events.count, (unsigned long)events.dropped);
      for (int i = 0; i < events.count; ++i) {
        const Event &ev = events.at(i);
        USBSerial.printf(" %s@%lus", EVENT_NAMES[ev.type], (unsigned long)(ev.ms / 1000));
      }
      USBSerial.println();
      break;
    case 'h':
      USBSerial.println("keys: t tap, n night, p pickup, d drop, k dark-restored, q demo Question, 1/2/3 press a button, x clear, a aggrieved, w pleased, z asleep, v waiting, e events, c claim, b heartbeat, i identity + boot I2C, m ration state, s doze state + last wake, S doze now, W forget wifi, R register again");
      break;
    default: break;
  }
}

// ------------------------------------------------------------------- loop ---

static uint32_t lastFrameUs = 0, lastLogMs = 0, frames = 0;
static uint32_t rasterUs = 0, blitUs = 0;
static Rect prevBody = {0, 0, -1, -1};

static float ax = 0.0f, ay = 0.0f, az = 1.0f;
static float gx = 0.0f, gy = 0.0f, amag = 1.0f;
static float motion = 0.0f;

// One heartbeat from inside the doze. The battery is read first: a
// fifteen-minute-old percentage is not worth sending, and the File would
// rather have the truth than a round number.
static void dozeBeatNow() {
  ++dozeBeats;
  lastBatteryPollMs = 0;   // it has been fifteen minutes; take a reading now
  batteryPoll(millis());
  netUpdateSnapshot(battery.pct, battery.charging, battery.vbus, orientationNow,
                    (uint32_t)sinceHandledS);
  if (!netSleepBeat(DOZE_BEAT_TIMEOUT_MS)) ++dozeBeatFails;
}

// The doze. Blocks until something ends it, which is the point: nothing else
// in this firmware should be running while it does.
static void dozeRun(bool forced) {
  const uint32_t enteredMs = millis();
  ++dozeCount;
  dozing = true;

  if (poolStateDirty) poolStateSave();   // a night must not lose the cursors

  USBSerial.printf("doze: down at %.0fs idle%s%s — beat every %lus, slice %lums\n",
                   idleFor, isNight() ? ", night" : "", forced ? ", FORCED" : "",
                   (unsigned long)(DOZE_BEAT_MS / 1000),
                   (unsigned long)(POTATO_IMU_INT_PIN >= 0 ? DOZE_SLICE_INT_MS
                                                           : DOZE_SLICE_POLLED_MS));

  // One heartbeat on the way down, through the normal path while the radio is
  // still up, so the fifteen-minute clock starts from a known point instead
  // of from whenever the last one happened to land.
  {
    uint32_t before, now;
    { NetLock l; before = net.heartbeats; }
    netRequestHeartbeat();
    for (int i = 0; i < 100; ++i) {
      { NetLock l; now = net.heartbeats; }
      if (now != before) break;
      delay(50);
    }
  }

  // Hand the watch to the sensor. Gyroscope off, accelerometer down to
  // low-power 128 Hz, the QMI8658's own comparator armed: about 1.5 mA
  // becomes tens of microamps, and nothing on this chip looks at
  // acceleration again until the potato is awake.
  // If the sensor will not arm, there is nothing left that can notice the
  // Hands, and a potato that cannot be woken is worse than one with
  // yesterday's battery life. Back out before the Net is stood down —
  // nothing has been given up yet — and do not try again for five minutes.
  if (!imuEnterWom(qmi, POTATO_WOM_MG)) {
    USBSerial.println("doze: the QMI8658 would not arm — staying up, again in five minutes");
    imuLeaveWom(qmi);
    // configWakeOnMotion() resets the chip before it does anything else, so
    // even a failed attempt leaves the sensor freshly reset: the impulse
    // detectors have to be held off here exactly as they are on a real wake.
    detectorHoldMs = millis() + 300;
    motion = motionFloor;
    handledFor = 0.0f;
    wasHandled = false;
    freefallFor = 0.0f;
    dropArmedUntilMs = 0;
    shakePeaks = 0;
    inPeak = false;
    lastFrameUs = micros();
    dozeRetryAtMs = millis() + DOZE_RETRY_MS;
    dozing = false;
    return;
  }
  imuWomFired(qmi);   // STATUS1 clears on read: begin from a clean latch
  imuWomFired(qmi);

  netSleep(10000);    // the task takes the radio down itself

  // Wake sources. The timer is re-armed each slice; a GPIO is armed once,
  // and only if it is genuinely idle right now — a level-triggered wake on a
  // line that is already asserted returns from every sleep immediately and
  // costs more than staying awake.
  dozeImuIntArmed = false;
  dozeTouchIntArmed = false;
  bool anyGpio = false;
  if (POTATO_IMU_INT_PIN >= 0) {
    pinMode(POTATO_IMU_INT_PIN, INPUT);
    if (digitalRead(POTATO_IMU_INT_PIN) == LOW) {   // WoM idles this low
      gpio_wakeup_enable((gpio_num_t)POTATO_IMU_INT_PIN, GPIO_INTR_HIGH_LEVEL);
      dozeImuIntArmed = true;
      anyGpio = true;
    }
  }
#if POTATO_TOUCH_WAKE
  // GPIO21 is the only true hardware interrupt on this board (sleep.h), so
  // it is worth arming even though a tap is not a pick-up.
  if (!dozeTouchWakeGivenUp) {
    pinMode(TP_INT, INPUT_PULLUP);
    bool idleHigh = true;
    for (int i = 0; i < 10 && idleHigh; ++i) {
      if (digitalRead(TP_INT) == LOW) idleHigh = false;
      delay(5);
    }
    if (idleHigh) {
      gpio_wakeup_enable((gpio_num_t)TP_INT, GPIO_INTR_LOW_LEVEL);
      dozeTouchIntArmed = true;
      anyGpio = true;
    }
  }
#endif
  if (anyGpio) esp_sleep_enable_gpio_wakeup();

  // Long slices are only affordable while a hardware wake can cut through
  // them; without one the slice is how fast a pick-up is answered.
  uint32_t sliceMs = dozeImuIntArmed ? DOZE_SLICE_INT_MS : DOZE_SLICE_POLLED_MS;
  uint32_t lastBeatMs = millis(), lastYieldMs = millis();
  uint32_t slices = 0, rejects = 0, beats = 0;
  uint8_t faults = 0, spurious = 0;
  WakeReason reason = WAKE_NONE;

  while (reason == WAKE_NONE) {
    esp_sleep_enable_timer_wakeup((uint64_t)sliceMs * 1000ULL);
    const uint32_t beforeMs = millis();
    const esp_err_t err = esp_light_sleep_start();
    if (err != ESP_OK) {
      ++dozeRejects;      // a wake source was already pending; do not spin
      delay(sliceMs);
      // Refused every time means an armed level is stuck asserted, and a
      // doze that never actually sleeps costs more than one that never
      // starts. Drop the GPIO sources and carry on with the timer.
      if (++rejects >= 20 && (dozeImuIntArmed || dozeTouchIntArmed)) {
        if (dozeTouchIntArmed) { gpio_wakeup_disable((gpio_num_t)TP_INT); dozeTouchIntArmed = false; dozeTouchWakeGivenUp = true; }
        if (dozeImuIntArmed) { gpio_wakeup_disable((gpio_num_t)POTATO_IMU_INT_PIN); dozeImuIntArmed = false; }
        esp_sleep_disable_wakeup_source(ESP_SLEEP_WAKEUP_GPIO);
        sliceMs = DOZE_SLICE_POLLED_MS;   // the latch read is the wake path now
        USBSerial.println("doze: light sleep kept being refused — GPIO wakes dropped");
      }
    }
    // ESP-IDF advances esp_timer from the RTC on the way out of light sleep,
    // so millis() covers the slept time and every millis()-keyed clock in
    // this file stays true across the gap. The 's' dump prints the observed
    // slice length so that is checkable on hardware rather than assumed.
    const uint32_t sleptMs = millis() - beforeMs;
    const float sleptS = sleptMs * 0.001f;
    ++slices;
    ++dozeSlices;
    // These two are accumulated from dt in the frame loop, which does not run
    // here. The heartbeat's since_handled_s and the left-alone ladder both
    // depend on them, so the slept time has to be put back by hand.
    sinceHandledS += sleptS;
    idleFor += sleptS;

    // Only meaningful when the chip actually slept: after a refusal this
    // still reports whatever woke the previous slice.
    const esp_sleep_wakeup_cause_t cause =
        err == ESP_OK ? esp_sleep_get_wakeup_cause() : ESP_SLEEP_WAKEUP_UNDEFINED;
    // Only a slice that ran to its timer says anything about the clock; one
    // cut short by a GPIO is legitimately shorter than it asked for.
    if (cause == ESP_SLEEP_WAKEUP_TIMER) {
      dozeSliceAskedMs = sliceMs;
      dozeSliceSeenMs = sleptMs;
    }
    if (cause == ESP_SLEEP_WAKEUP_GPIO) {
      if (dozeImuIntArmed && digitalRead(POTATO_IMU_INT_PIN) == HIGH) reason = WAKE_MOTION;
      else if (dozeTouchIntArmed && digitalRead(TP_INT) == LOW) reason = WAKE_TOUCH;
      else {
        ++spurious;
        ++dozeGpioSpurious;
        if (spurious >= DOZE_GPIO_SPURIOUS) {
          if (dozeTouchIntArmed) {
            gpio_wakeup_disable((gpio_num_t)TP_INT);
            dozeTouchIntArmed = false;
            dozeTouchWakeGivenUp = true;   // sticky: do not try it again
            USBSerial.println("doze: touch INT fired with nothing behind it — disarmed");
          } else if (dozeImuIntArmed) {
            gpio_wakeup_disable((gpio_num_t)POTATO_IMU_INT_PIN);
            dozeImuIntArmed = false;
            USBSerial.println("doze: IMU INT fired with nothing behind it — disarmed");
          }
        }
      }
    }

    // The sensor's latch, one register read. This is the interrupt being
    // read over I2C, not the accelerometer being sampled and judged here —
    // the QMI8658 decided, in hardware, at 128 Hz, while this chip was off.
    // Only needed because its INT cannot reach this chip (sleep.h).
    if (reason == WAKE_NONE && !dozeImuIntArmed) {
      const int fired = imuWomFired(qmi);
      if (fired < 0) {
        ++dozeI2cFaults;
        // Sleeping blind is worse than not sleeping at all: the failure
        // mode has to be "yesterday's battery life", never "a potato that
        // cannot be woken".
        if (++faults >= DOZE_I2C_FAULTS) reason = WAKE_FAULT;
      } else {
        faults = 0;
        if (fired) {
          if (slices <= DOZE_WOM_SETTLE_SLICES) {
            ++dozeWomGuards;      // on the first slices, more likely stale than real
            imuWomFired(qmi);     // clear it and keep sleeping
          } else {
            reason = WAKE_MOTION;
          }
        }
      }
    }

    // The Hands plugging it in at three in the morning. Through the same
    // 2-sample debounce the frame loop uses, so vbusGood is coherent when
    // the loop takes back over. A forced doze ignores it — otherwise it
    // would end on the very USB cable it is being tested over.
    vbusPoll(millis());
    if (reason == WAKE_NONE && !forced && vbusGood) reason = WAKE_POWER;

    if (reason == WAKE_NONE && millis() - lastBeatMs >= DOZE_BEAT_MS) {
      lastBeatMs = millis();
      ++beats;
      dozeBeatNow();
    }
    if (reason == WAKE_NONE && forced && millis() - enteredMs >= DOZE_FORCED_MAX_MS) {
      reason = WAKE_FORCED;
    }
    // Give both idle tasks the CPU a few times a second. Nothing runs while
    // the chip is in light sleep, the task watchdog watches the idle tasks,
    // and a watchdog reboot at 3am is a worse bug than the one being fixed.
    if (millis() - lastYieldMs >= 500) { lastYieldMs = millis(); delay(3); }
  }

  // ------------------------------------------------------------------ up ---

  imuLeaveWom(qmi);

  // The accelerometer has just been reset and reconfigured. Its first samples
  // are not a fall and not a shake, and the motion filter has no history —
  // start it at the floor so the first frame cannot read as a pick-up that
  // never happened.
  detectorHoldMs = millis() + 300;
  motion = motionFloor;
  handledFor = 0.0f;
  wasHandled = false;
  freefallFor = 0.0f;
  dropArmedUntilMs = 0;
  shakePeaks = 0;
  inPeak = false;
  lastFrameUs = micros();   // dt must not be a fifteen-minute step

  // Ladders that would otherwise fire every stage they slept through, one
  // per frame, at a panel nobody is looking at. They happened; they were
  // simply never said, which is the most in-character thing about them.
  while (aloneStage < 6 && sinceHandledS >= ALONE_T_S[aloneStage]) ++aloneStage;
  if (inDark) {
    const uint32_t darkS = (millis() - darkStartMs) / 1000;
    if (darkS >= 3 * 3600) darkStage = 3;
    else if (darkS >= 3600) darkStage = 2;
    else if (darkS >= 600) darkStage = 1;
  }

  // The panel is not touched here on purpose: clearing idleFor is enough for
  // the frame loop's own power policy to light it on the very next pass,
  // face-down still wins, and there is only one place that knows how.
  if (reason == WAKE_MOTION || reason == WAKE_TOUCH) idleFor = 0.0f;
  // A sensor that stopped answering would otherwise be re-armed on the very
  // next frame, because nothing about being idle has changed.
  if (reason == WAKE_FAULT) dozeRetryAtMs = millis() + DOZE_RETRY_MS;
  else dozeRetryAtMs = 0;

  netWake();

  dozing = false;
  dozeLastWake = reason;
  dozeLastWakeMs = millis();
  dozeLastMs = millis() - enteredMs;
  dozeTotalMs += dozeLastMs;
  USBSerial.printf("doze: up after %lus — %s | %lu slices, %lu beats this doze, "
                   "%lu refused, %lu stale latches%s\n",
                   (unsigned long)(dozeLastMs / 1000), wakeReasonName(reason),
                   (unsigned long)slices, (unsigned long)beats, (unsigned long)rejects,
                   (unsigned long)dozeWomGuards,
                   reason == WAKE_FAULT ? " | the sensor stopped answering; staying up" : "");
}

void loop() {
  const uint32_t frameStart = micros();
  const uint32_t tNow = millis();
  float dt = (frameStart - lastFrameUs) * 1e-6f;
  lastFrameUs = frameStart;
  if (dt <= 0.0f || dt > 0.1f) dt = 0.016f;

  if (USBSerial.available()) serialCommand(USBSerial.read());

  // ------------------------------------------------------------- sensing ---

  IMUdata s, g;
  if (qmi.getDataReady() && qmi.getAccelerometer(s.x, s.y, s.z)) {
    ax = s.x; ay = s.y; az = s.z;
    accToScreen(ax, ay, &gx, &gy);
    amag = sqrtf(ax * ax + ay * ay + az * az);
  }
  const float inPlane = sqrtf(gx * gx + gy * gy);
  float spin = 0.0f;
  if (qmi.getGyroscope(g.x, g.y, g.z)) {
    spin = sqrtf(g.x * g.x + g.y * g.y + g.z * g.z);
  }

  // Being handled shows up as sustained small disturbance, which the gyro sees
  // far better than the accelerometer: a slow careful lift barely moves |a|.
  const float disturb = fabsf(amag - 1.0f) + spin * 0.0016f;
  motion += (disturb - motion) * fminf(dt * 6.0f, 1.0f);

  // Track the resting noise floor so handling is judged as excess over it.
  // Asymmetric on purpose: falls fast, rises slowly, and always creeps a
  // little even while handled, so it can never deadlock at a wrong value.
  const bool settling = (millis() - bootMs) < 1500;
  float rate;
  if (settling)                  rate = 3.00f;   // seed from the settled filter
  else if (motion < motionFloor) rate = 4.00f;   // quiet again: drop to it
  else if (wasHandled)           rate = 0.02f;   // creep, do not chase
  else                           rate = 0.25f;
  motionFloor += (motion - motionFloor) * fminf(dt * rate, 1.0f);

  const float excess = motion - motionFloor;

  // Straight out of a doze the sensor has just been reset and reconfigured.
  // Its first samples are not a fall and not a shake; the impulse detectors
  // stay out of the way for 300 ms rather than inventing an incident.
  const bool detectorHold = (int32_t)(millis() - detectorHoldMs) < 0;
  const bool freefall = amag < FREEFALL_G && !detectorHold;
  const bool impact = amag > IMPACT_G && !detectorHold;
  if (settling) wasHandled = false;
  else if (!wasHandled && excess > HANDLE_ON) wasHandled = true;
  else if (wasHandled && excess < HANDLE_OFF) wasHandled = false;

  // wasHandled is "above the line right now". handled is "and it has stayed
  // there long enough to be a hand rather than a bump".
  if (wasHandled) handledFor += dt; else handledFor = 0.0f;
  const bool handled = handledFor > HANDLE_MIN_S;

  // Poll touch in the frame loop. The controller interrupt is an event latch,
  // not an authoritative "still down" signal, and no I2C belongs in an ISR.
  const bool wasTouching = touching;
  bool rawTouch = false;
  int16_t tx = touchX, ty = touchY;
  if (touchReady && readTouchPoint(&tx, &ty) &&
      tx >= 0 && tx < LCD_WIDTH && ty >= 0 && ty < LCD_HEIGHT) {
    rawTouch = true;
    touchX = tx;
    touchY = ty;
    touchLostFor = 0.0f;
  } else if (touching) {
    // One missed I2C sample must not turn a hold into a release and re-arm it.
    touchLostFor += dt;
  }
  touching = rawTouch || (touching && touchLostFor < 0.06f);

  bool touchOverBody = false;
  if (touching) {
    const float dx = touchX - hitBX, dy = touchY - hitBY;
    const float c = cosf(hitTheta), sn = sinf(hitTheta);
    const float lx = dx * c + dy * sn;
    const float ly = -dx * sn + dy * c;
    const float nx = lx / fmaxf(hitRX * 1.08f, 1.0f);
    const float ny = ly / fmaxf(hitRY * 1.08f, 1.0f);
    touchOverBody = nx * nx + ny * ny <= 1.0f;
  }

  const bool beganTouch = rawTouch && !wasTouching;
  if (beganTouch && uiCardActive()) {
    // Tapping dismisses the card early; that touch is not a tap on the face.
    uiClearCard();
    cardUntilMs = 0;
    cardTouch = true;
    USBSerial.println("card: dismissed by touch");
  }
  if (!touching) cardTouch = false;
  if (beganTouch && !cardTouch) {
    longPressFired = false;
    touchFor = 0.0f;
    pressingBody = touchOverBody;
    if (!touchOverBody) {
      pressedButton = (int8_t)uiButtonAt(touchX, touchY);
      uiSetPressed(pressedButton);
    }
  }
  if (!touching && pressedButton >= 0) {
    // A button fires on finger-up over the same button it went down on.
    const int b = uiButtonAt(touchX, touchY);
    uiSetPressed(-1);
    if (b == pressedButton) {
      excite(0.2f);
      choose(uiChoices[b]);
    }
    pressedButton = -1;
  }
  if (touching && pressingBody) {
    touchFor += dt;
    if (!longPressFired && touchFor >= LONG_PRESS_S) {
      longPressFired = true;
      excite(0.25f);
      USBSerial.printf("longpress touch=%d,%d\n", touchX, touchY);
      showStatusCard();
    }
  }
  if (touching && pressingBody && !touchOverBody) {
    // Slid off the body. Not a tap, not a hold; forget it.
    pressingBody = false;
    touchFor = 0.0f;
  }
  if (!touching && prevPressingBody) {
    // Only a real finger-up on the body is a tap.
    if (!longPressFired && touchFor < LONG_PRESS_S) {
      excite(0.30f);
      if (minorLineAllowed(millis())) { if (isNight()) sayNight(); else sayPool(POOL_TAP); }
      postEvent(EV_TAP);   // event as it happens; the server coalesces
    }
    pressingBody = false;
    touchFor = 0.0f;
  }
  if (!touching) pressingBody = false;
  prevPressingBody = pressingBody;

  // A flaky boot heals itself: anything not found at boot is re-probed every
  // 60 s. The PMU re-run repeats its full setup (measurements, 150 mA).
  if ((!powerReady || !touchReady) && tNow - lastReprobeMs >= 60000) {
    lastReprobeMs = tNow;
    if (!powerReady && pmuSetup("re-probe")) { vbusStable = vbusGood; vbusStableCand = vbusGood; }
    if (!touchReady) touchSetup("re-probe");
    if (!powerReady || !touchReady) {
      USBSerial.printf("re-probe: PMU %s, touch %s — again in 60 s\n",
                       powerReady ? "ok" : "missing", touchReady ? "ok" : "missing");
    }
  }

  vbusPoll(millis());

  const bool handledRise = handled && !prevHandled;
  prevHandled = handled;
  if (handledRise) excite(0.85f);
  if (freefall) excite(2.0f * dt);      // sustained alarm while airborne

  arousal -= arousal * T.arousalDecay * dt;
  habituation -= habituation * T.habituationDecay * dt;
  if (arousal < 0.0f) arousal = 0.0f;

  // ----------------------------------------------------------- detectors ---
  // Everything below runs whether or not the panel is lit: the dark is
  // precisely the case where the panel is off and the counting matters.

  const bool faceDown = az > FACEDOWN_Z;
  const bool dropRecent = (int32_t)(tNow - dropRefractoryMs) < 0;

  // Left alone. Thresholds say their line once per stretch; the return line
  // replaces the pickup line when it has been long enough to notice.
  if (handled) sinceHandledS = 0.0f; else sinceHandledS += dt;
  if (handledRise) aloneStage = 0;
  {
    static const char *const ALONE_L[6] = {LINE_ALONE_4H, LINE_ALONE_8H, LINE_ALONE_24H,
                                           LINE_ALONE_48H, LINE_ALONE_72H, LINE_ALONE_7D};
    if (aloneStage < 6 && sinceHandledS >= ALONE_T_S[aloneStage]) {
      say(ALONE_L[aloneStage], REACTION_S * 2.0f);
      ++aloneStage;
    }
  }

  // Sessions and the ration (§15). A session begins at the first pick-up and
  // ends after 60 s of stillness; it earns at most one line, at the start.
  // The pick-up line is a fresh-encounter line — only ten minutes or more
  // since the last session ended — and then only if the shared minor budget
  // allows. Moving her around within the session says nothing more.
  if (handledRise) {   // a real lift edge: the event fires, the server coalesces
    postEvent(EV_PICKUP);
    if (!sessionActive) {
      sessionActive = true;
      sessionSpoke = false;
      sessionStartMs = tNow;
      sessionLifts = 1;
      sessionQuietS = 0.0f;
      const bool tenMinOk = (lastSessionEndMs == 0) ||
                            (int32_t)(tNow - lastSessionEndMs) >= 600000;
      if (!dropRecent && tenMinOk && minorLineAllowed(tNow)) {
        const uint32_t away = lastSessionEndMs == 0 ? 0 : (tNow - lastSessionEndMs) / 1000;
        if (away >= 24 * 3600) say(LINE_RETURN_LONG, REACTION_S);
        else if (away >= 4 * 3600) say(LINE_RETURN, REACTION_S);
        else sayPickup();
        sessionSpoke = true;
      }
    } else {
      ++sessionLifts;   // same encounter; the File may note "Repeatedly."
    }
  }
  if (handled) { sessionLastActiveMs = tNow; sessionQuietS = 0.0f; }
  else if (sessionActive) {
    sessionQuietS += dt;
    if (sessionQuietS >= 60.0f) {   // 60 s of stillness closes the session
      sessionActive = false;
      lastSessionEndMs = tNow;
      const uint32_t durS = (sessionLastActiveMs - sessionStartMs) / 1000;
      // Put-down is the fallback, not a second line (§15): only after a
      // session of 30 s or more that began in silence, one time in three,
      // and only if the minor budget allows.
      if (durS >= 30 && !inDark && !sessionSpoke && seededRoll() < 0.3333f && minorLineAllowed(tNow)) {
        sayPool(POOL_PUTDOWN);
      }
    }
  }
  // The physical put-down event edge (set down and left for ~1 s), sent as it
  // happens; the line above is what the ration governs, not this record.
  if (handled) { wasHeld = true; heldQuietS = 0.0f; }
  else if (wasHeld) {
    heldQuietS += dt;
    if (heldQuietS >= 1.0f) { wasHeld = false; postEvent(EV_PUTDOWN); }
  }

  // The dark (§15). Confirmed after 5 s face-down AND still — not a flip in
  // the hand. The episode clock starts then, but "Dark." is spoken and
  // facedown_start sent only once it passes 60 s; a sub-minute episode leaves
  // no line, no event, no grievance. The 10 min / 1 h / 3 h escalations and
  // the counted restore are major and bypass the budget.
  if (faceDown && !handled) darkStillS += dt; else darkStillS = 0.0f;
  if (faceDown) faceUpFor = 0.0f; else faceUpFor += dt;
  if (!inDark && darkStillS >= 5.0f) {
    inDark = true;
    darkStartMs = tNow - 5000;   // the episode began when it first went down
    darkStage = 0;
    darkAnnounced = false;
  }
  if (inDark) {
    const uint32_t darkS = (tNow - darkStartMs) / 1000;
    if (!darkAnnounced && darkS >= 60) {   // a real episode: now she speaks
      darkAnnounced = true;
      say(LINE_DARK_NOW, REACTION_S);
      postEvent(EV_FACEDOWN_START);
    }
    if (darkStage == 0 && darkS >= 600) { say(LINE_DARK_10M, REACTION_S); darkStage = 1; }
    else if (darkStage == 1 && darkS >= 3600) { say(LINE_DARK_1H, REACTION_S); darkStage = 2; }
    else if (darkStage == 2 && darkS >= 3 * 3600) { say(LINE_DARK_3H, REACTION_S); darkStage = 3; }
    if (faceUpFor >= 1.0f) {
      inDark = false;
      if (darkAnnounced) {   // only episodes that reached 60 s go to the server
        postEvent(EV_FACEDOWN_END, (int32_t)darkS);
        if (darkS >= 600) sayCounted(POOL_DARK_RESTORED, darkS);   // restore line: 10 min+
      }
    }
  }

  // The ceiling situation (§15): standing on its head. Screen +y is down, so
  // upright has gravity at +gy and inverted at -gy. The orientation event
  // fires at 2 s; the line is a major that speaks only once she has been up
  // there five minutes — a quick flip says nothing.
  const bool invertedNow = inPlane > 0.6f && gy < -0.7f && !faceDown;
  if (invertedNow) { invertedFor += dt; uprightFor = 0.0f; }
  else { uprightFor += dt; invertedFor = 0.0f; }
  if (!inCeiling && invertedFor >= 2.0f) {
    inCeiling = true;
    ceilingStartMs = tNow;
    ceilingSaid = false;
    ceiling20Said = false;
    postEvent(EV_INVERTED_START);
  }
  if (inCeiling) {
    const uint32_t ceilS = (tNow - ceilingStartMs) / 1000;
    if (!ceilingSaid && ceilS >= 5 * 60) { sayPool(POOL_CEILING); ceilingSaid = true; }
    else if (ceilingSaid && !ceiling20Said && ceilS >= 20 * 60) { say(LINE_CEILING_20M, REACTION_S); ceiling20Said = true; }
    if (uprightFor >= 1.0f) {
      inCeiling = false;
      if (ceilingSaid) say(LINE_CEILING_RESTORED, REACTION_S);
      postEvent(EV_INVERTED_END, (int32_t)ceilS);
    }
  }

  // Shaken: four jolts of more than 0.9g inside a second and a half. A drop's
  // single impact is one jolt and does not count.
  {
    const float jolt = fabsf(amag - 1.0f);
    if (!detectorHold && !inPeak && jolt > 0.9f) {
      inPeak = true;
      if (shakePeaks == 0 || tNow - shakeFirstMs > 1500) { shakePeaks = 0; shakeFirstMs = tNow; }
      ++shakePeaks;
    } else if (inPeak && jolt < 0.45f) {
      inPeak = false;
    }
    if (shakePeaks >= 4 && (int32_t)(tNow - shakeRefractoryMs) >= 0) {
      shakePeaks = 0;
      shakeRefractoryMs = tNow + 3000;
      alarmedUntilMs = tNow + 4000;
      sayPool(POOL_SHAKE);
      postEvent(EV_SHAKE);
    }
  }

  // Dropped: at least 100ms of free fall (a 5cm fall) then an impact within
  // 600ms. Blank screen for one second, then the line.
  if (freefall) freefallFor += dt; else freefallFor = 0.0f;
  if (freefallFor >= 0.10f) dropArmedUntilMs = tNow + 600;
  if (impact && (int32_t)(tNow - dropArmedUntilMs) < 0 && !dropRecent) {
    dropArmedUntilMs = 0;
    dropRefractoryMs = tNow + 3000;
    blankUntilMs = tNow + 1000;
    blanked = false;
    alarmedUntilMs = tNow + 5000;
    sayPool(POOL_DROP);
    postEvent(EV_DROP);
  }

  // Transit: moving, with gaps under ten seconds, for two minutes. It ends
  // after a minute of stillness somewhere.
  if (handled) { movingS += dt; movingGapS = 0.0f; }
  else { movingGapS += dt; if (!inTransit && movingGapS > 10.0f) movingS = 0.0f; }
  if (!inTransit && movingS >= 120.0f) {
    inTransit = true;
    transitStartMs = tNow;
    sayPool(POOL_TRANSIT);
    postEvent(EV_TRANSIT_START);
  }
  if (inTransit && movingGapS >= 60.0f) {
    inTransit = false;
    movingS = 0.0f;
    sayPool(POOL_SETTLE);
    postEvent(EV_TRANSIT_END, (int32_t)((tNow - transitStartMs) / 1000 - 60));
  }

  // Plugged in / unplugged (§15): real only after 60 s continuously in the
  // new VBUS state — a cable that wiggles in the hand is not an event. The
  // event fires once real; the line is minor (shared budget).
  if (vbusGood != vbusStableCand) { vbusStableCand = vbusGood; vbusCandSinceMs = tNow; }
  if (!settling && vbusStableCand != vbusStable &&
      (int32_t)(tNow - vbusCandSinceMs) >= 60000) {
    vbusStable = vbusStableCand;
    if (vbusStable) {
      battStage = 0;              // fresh charge: re-arm the thresholds
      battFullSaid = false;
      if (minorLineAllowed(tNow)) sayPool(POOL_PLUGGED);
      postEvent(EV_CHARGE_START);
    } else {
      if (minorLineAllowed(tNow)) say(LINE_UNPLUGGED, REACTION_S);
      postEvent(EV_CHARGE_END);
    }
  }
  batteryPoll(tNow);

  // Orientation, for the heartbeat and for requests. Screen +y is down.
  if (faceDown) strcpy(orientationNow, "down");
  else if (invertedNow) strcpy(orientationNow, "inverted");
  else if (inPlane > 0.6f && fabsf(gx) > 0.7f) strcpy(orientationNow, "side");
  else strcpy(orientationNow, "up");

  // Requests: verified here, on the device. The server only counts.
  if (request.active) {
    const time_t nowEpoch = time(nullptr);
    if (nowEpoch > 1700000000 && request.expiresAt && (uint32_t)nowEpoch > request.expiresAt) {
      postEvent(EV_REQUEST_EXPIRED, 0, request.id);
      request.active = false;
      uiSetChoices(nullptr, 0);
    } else if (strcmp(request.check, "tap") != 0) {
      bool ok = false;
      if (!strncmp(request.check, "orientation:", 12)) ok = !strcmp(orientationNow, request.check + 12);
      else if (!strncmp(request.check, "still", 5)) ok = !handled;
      else if (!strncmp(request.check, "held", 4)) ok = handled;
      else if (!strcmp(request.check, "transit")) ok = inTransit;
      request.satisfiedS = ok ? request.satisfiedS + dt : 0.0f;
      if (ok && request.satisfiedS >= fmaxf(request.needS, 1.0f)) {
        postEvent(EV_REQUEST_DONE, 0, request.id);
        request.active = false;
      }
    }
  }

  netPoll(tNow);

  // ----------------------------------------------------------------- power ---

  if (handled || touching) idleFor = 0.0f; else idleFor += dt;

  // Exponential rather than a spring: this must reach its target and stay
  // there, and a spring that overshoots would flicker the panel at the
  // threshold. Slower to fall asleep than to wake, which is also how it reads.
  sleepT += ((faceDown ? 1.0f : 0.0f) - sleepT) * fminf(dt * (faceDown ? 3.0f : 6.0f), 1.0f);

  // External power keeps the potato visible, but still lets it dim. This is
  // deliberately VBUS, not "serial monitor open". Face-down always wins.
  const bool wantDark = (sleepT > 0.97f) || (!vbusGood && idleFor > DARK_AFTER_S) || dozeForce;

  if (wantDark && panelOn) {
    clearPanelBlack();
    gfx->displayOff();
    panelOn = false;
    prevBody = (Rect){0, 0, -1, -1};
  } else if (!wantDark && !panelOn) {
    gfx->displayOn();
    curBright = 0;              // force a brightness write below
    panelOn = true;
    uiDirty = true;             // the clear took the text with it
  }

  if (!panelOn) {
    // Still sensing, just not drawing. This is the wake path. Keep talking:
    // a device that goes dark AND silent is indistinguishable from a hung one.
    const uint32_t nowMs = millis();
    if (nowMs - lastLogMs >= 2000) {
      USBSerial.printf("asleep | idle %.0fs sleep %.2f%s — %s\n", idleFor, sleepT,
                       faceDown ? " FACEDOWN" : "",
                       faceDown ? "turn it over to wake" : "pick it up to wake");
      lastLogMs = nowMs;
    }
    // Dark is not the same as quiet. The panel being off saved nothing on
    // the night of the 23rd — this is where the rest of the board goes down
    // too. Only ever entered from here, so the doze can never start with
    // something on the glass.
    if (dozeForce) { dozeForce = false; dozeRun(true); return; }
    char why[48];
    if (dozeAllowed(why, sizeof(why), true)) { dozeRun(false); return; }
    delay(IDLE_FRAME_US / 1000);
    return;
  }

  uint8_t wantBright = BRIGHT_FULL;
  if (idleFor > DIM_AFTER_S) {
    const float t = fminf((idleFor - DIM_AFTER_S) / DIM_RAMP_S, 1.0f);
    wantBright = (uint8_t)(BRIGHT_FULL + (BRIGHT_DIM - (int)BRIGHT_FULL) * t);
  }
  if (wantBright != curBright) {
    gfx->setBrightness(wantBright);
    curBright = wantBright;
  }

  // The drop: nothing on the glass for one second, then the line.
  if ((int32_t)(tNow - blankUntilMs) < 0) {
    if (!blanked) {
      clearPanelBlack();
      uiBlank();
      prevBody = (Rect){0, 0, -1, -1};
      blanked = true;
    }
    delay(10);
    return;
  }

  asleepNow = (isNight() && idleFor > 300.0f) ||
              expression == EXPR_ASLEEP || expression == EXPR_DORMANT;
  if (uiCardActive() && (int32_t)(tNow - cardUntilMs) >= 0) uiClearCard();
  refreshLine();
  uiDraw();

  // ------------------------------------------------------------- posture ---

  float conf = (inPlane - FLAT_G) / (TILT_G - FLAT_G);
  conf = fminf(fmaxf(conf, 0.0f), 1.0f);

  const float rawLean = atan2f(gx, gy);
  const float lean = rawLean * conf;

  // Split gravity from linear acceleration: a slow low-pass is gravity, the
  // residual is what someone is doing to it right now.
  gvX += (gx - gvX) * fminf(dt * 2.0f, 1.0f);
  gvY += (gy - gvY) * fminf(dt * 2.0f, 1.0f);
  const float linX = gx - gvX, linY = gy - gvY;

  // Only the component perpendicular to gravity squashes it sideways. Gravity
  // points along (sin lean, cos lean), so the perpendicular is (cos, -sin).
  const float lat = linX * cosf(lean) - linY * sinf(lean);
  const float slosh = fminf(fabsf(lat) * SLOSH_PER_G, SLOSH_MAX);

  breathPhase += dt * T.breathRate * (1.0f + arousal * 1.2f);
  const float breath = sinf(breathPhase) * T.breathDepth;

  // Scale factors on the variety's resting semi-axes.
  float tSx = (1.0f + slosh) * (1.0f - breath);
  float tSy = (1.0f - slosh * 0.72f) * (1.0f + breath);
  if (freefall) { tSx *= 0.80f; tSy *= 1.28f; }
  if (impact)   { tSx *= 1.20f; tSy *= 0.78f; }

  springTo(sPerk, arousal, 90.0f, 12.0f, dt);
  tSy *= 1.0f + sPerk.x * T.perkHeight;

  // Asleep it puddles: spreads sideways and flattens.
  tSx *= 1.0f + 0.30f * sleepT;
  tSy *= 1.0f - 0.55f * sleepT;

  // Negated: body-down maps to screen (-r sin t, r cos t), so a draw angle of
  // +lean would point the potato's underside away from gravity.
  springTo(sLean, -lean, LEAN_K, LEAN_C, dt);
  springTo(sSx, tSx, SHAPE_K, SHAPE_C, dt);
  springTo(sSy, tSy, SHAPE_K, SHAPE_C, dt);
  springTo(sDrift, gx * conf * DRIFT_PX, SHAPE_K * 0.5f, SHAPE_C, dt);

  wanderPhase += dt * WANDER_RATE;
  const float bx = HOME_X + sDrift.x + sinf(wanderPhase * 2.0f) * WANDER_PX;
  const float by = HOME_Y + cosf(wanderPhase * 1.37f) * WANDER_PX
                   + sleepT * 0.22f * SHAPE.ry;

  // ---------------------------------------------------------- eyes, gaze ---

  if (touching) {
    // Gaze targets are body-local. Undo the current body rotation before
    // mapping the finger vector into the existing -1..1 target range.
    const float dx = touchX - hitBX;
    const float dy = touchY - hitBY;
    const float c = cosf(sLean.x), sn = sinf(sLean.x);
    const float localX = dx * c + dy * sn;
    const float localY = -dx * sn + dy * c;
    gazeTX = fminf(fmaxf(localX / (BASE_R * 0.85f), -1.0f), 1.0f);
    gazeTY = fminf(fmaxf(localY / (BASE_R * 0.85f), -1.0f), 1.0f);
  } else if ((int32_t)(tNow - glanceUntilMs) < 0) {
    // A line just appeared, or an idle glance is due: down, at the text
    // band. A momentary glance outranks the standing unread posture.
    gazeTX = glanceX;
    gazeTY = 1.0f;
  } else if (fileUnread > 0) {
    // The File has entries. Eyes toward the nearest screen edge.
    gazeTX = sDrift.x >= 0.0f ? 1.0f : -1.0f;
    gazeTY = 0.15f;
  } else {
    // At rest the eyes are forward, on the Hands. No side-to-side scanning;
    // a potato does not read the county. Now and then it glances down at
    // the line on its own; stirred, it just watches you.
    gazeTX = 0.0f;
    gazeTY = 0.0f;
    glanceIn -= dt;
    if (glanceIn <= 0.0f) {
      glanceIn = frange(T.glanceMin, T.glanceMax) * (1.0f + arousal);
      if (arousal < 0.35f) {
        glanceX = frange(-0.25f, 0.25f);
        glanceUntilMs = tNow + (uint32_t)frange(900.0f, 1600.0f);
      }
    }
  }
  springTo(sGazeX, gazeTX, T.gazeSettle, 18.0f, dt);
  springTo(sGazeY, gazeTY, T.gazeSettle, 18.0f, dt);

  blinkIn -= dt;
  if (blinkT >= 0.0f) {
    blinkT += dt / 0.14f;
    if (blinkT > 1.0f) {
      blinkT = -1.0f;
      blinkIn = frange(T.blinkMin, T.blinkMax) * (1.0f - arousal * 0.4f);
    }
  } else if (blinkIn <= 0.0f) {
    blinkT = 0.0f;
  }
  // Sleeps at night (layer 1): five idle minutes between 23:00 and 06:00
  // close the eyes, dim the body and blank the line. Any touch wakes it.
  const bool nightAsleep = isNight() && idleFor > 300.0f;
  const EyePose pose = eyePoseFor(nightAsleep ? EXPR_ASLEEP : expression);
  const float blink = fmaxf(blinkCurve(blinkT), sleepT);
  const float alarm = (int32_t)(tNow - alarmedUntilMs) < 0 ? 1.35f : 1.0f;

  // ------------------------------------------------------------ geometry ---

  const float sx = SHAPE.rx * sSx.x, sy = SHAPE.ry * sSy.x, th = sLean.x;
  const float ct = cosf(th), st = sinf(th);
  hitBX = bx; hitBY = by;
  hitRX = sx; hitRY = sy; hitTheta = th;

  potatoOutline(SHAPE, bx, by, sx, sy, th);
  Rect bodyRect = {(int)floorf(outMinX) - 2, (int)floorf(outMinY) - 2,
                   (int)ceilf(outMaxX) + 2, (int)ceilf(outMaxY) + 2};

  // The dirty region includes the previous position so motion cannot trail.
  Rect dirty = unionRect(bodyRect, prevBody);
  prevBody = bodyRect;

  // The CO5300 addresses columns in pairs and the driver does not align for us.
  // Odd edges shear the panel. Safe at the bounds: 367 and 447 are both odd.
  if (dirty.x0 < 0) dirty.x0 = 0;
  if (dirty.y0 < 0) dirty.y0 = 0;
  if (dirty.x1 > LCD_WIDTH - 1) dirty.x1 = LCD_WIDTH - 1;
  if (dirty.y1 > TEXT_Y - 1) dirty.y1 = TEXT_Y - 1;   // never blit over the text band
  dirty.x0 &= ~1;
  dirty.y0 &= ~1;
  dirty.x1 |= 1;
  dirty.y1 |= 1;
  const int dirtyW = dirty.x1 - dirty.x0 + 1;
  const int dirtyH = dirty.y1 - dirty.y0 + 1;
  const uint32_t dirtyPixels = (uint32_t)dirtyW * dirtyH;
  const bool oddDirty = ((dirty.x0 | dirty.y0 | dirtyW | dirtyH) & 1) != 0;

  // -------------------------------------------------------------- drawing ---

  static BodyPaint paint;
  setupBodyPaint(paint, SHAPE, bx, by, sx, sy, th, pose.dim);
  const uint16_t inkNow = mixColor(0x0000, SHAPE.ink, pose.dim);
  const uint16_t dimpleNow = mixColor(0x0000, SHAPE.dimple, pose.dim);
  const float gxo = sGazeX.x * T.gazeRange * sx;
  const float gyo = sGazeY.x * T.gazeRange * sy;

  auto rasterScene = [&]() {
    potatoFill(paint);

    for (int i = 0; i < POTATO_DIMPLES; ++i) {
      const Dimple &d = SHAPE.dimples[i];
      float px, py;
      bodyToScreen(bx, by, ct, st, d.x * sx, d.y * sy, &px, &py);
      ellipseRot(px, py, d.rx * sx, d.ry * sx, th + d.rot, dimpleNow);
    }

    // The two face-eyes. Expression is eye shape only; a blink squashes
    // them shut; asleep they are downward arcs.
    for (int i = 0; i < 2; ++i) {
      const float lx = SHAPE.eyeX[i] * sx + gxo;
      const float ly = (SHAPE.eyeY[i] + pose.dy) * sy + gyo;
      const float grow = alarm * (1.0f + arousal * 0.10f);
      const float erx = SHAPE.eyeRX[i] * sx * pose.scaleX * grow;
      const float ery = SHAPE.eyeRY[i] * sy * pose.scaleY * grow;
      float px, py;
      if (pose.closed || blink > 0.92f) {
        float x0, y0, x1, y1, qx, qy;
        bodyToScreen(bx, by, ct, st, lx - erx * 1.15f, ly, &x0, &y0);
        bodyToScreen(bx, by, ct, st, lx + erx * 1.15f, ly, &x1, &y1);
        bodyToScreen(bx, by, ct, st, lx, ly + ery * 0.65f, &qx, &qy);
        arcStroke(x0, y0, qx, qy, x1, y1, 1.6f, inkNow);
      } else {
        bodyToScreen(bx, by, ct, st, lx, ly, &px, &py);
        ellipseRot(px, py, erx, fmaxf(ery * (1.0f - blink), 1.0f), th, inkNow);
      }
    }
  };

  rasterUs = 0;
  blitUs = 0;
  uint8_t tileCount = 0;
  for (int tileY = dirty.y0; tileY <= dirty.y1; tileY += MAX_RECT) {
    const int tileH = min(MAX_RECT, dirty.y1 - tileY + 1);
    for (int tileX = dirty.x0; tileX <= dirty.x1; tileX += MAX_RECT) {
      const int tileW = min(MAX_RECT, dirty.x1 - tileX + 1);
      setWindow(tileX, tileY, tileW, tileH);

      const uint32_t tRaster = micros();
      memset(win, 0, (size_t)rcW * rcH * sizeof(uint16_t));
      rasterScene();
      rasterUs += micros() - tRaster;

      const uint32_t tBlit = micros();
      gfx->draw16bitRGBBitmap(rcX, rcY, win, rcW, rcH);
      blitUs += micros() - tBlit;
      ++tileCount;
    }
  }

  // ------------------------------------------------------------ telemetry ---

  // A line was spoken since the last save: persist the pool cursors, so the
  // next boot does not reopen with the same line.
  if (poolStateDirty) poolStateSave();

  ++frames;
  const uint32_t nowMs = millis();
  if (nowMs - lastLogMs >= 1000) {
    USBSerial.printf("fps %lu | raster %luus blit %luus | dirty %lupx %dx%d@%d,%d tiles %u%s | "
                     "arousal %.2f habit %.2f exc %+.3f idle %.0fs bright %u sleep %.2f %s | "
                     "lean %+.0f sx %.2f sy %.2f | touch %d body %d @%d,%d hold %.2f%s%s%s%s\n",
                     (unsigned long)frames, (unsigned long)rasterUs,
                     (unsigned long)blitUs, (unsigned long)dirtyPixels,
                     dirtyW, dirtyH, dirty.x0, dirty.y0, (unsigned)tileCount,
                     oddDirty ? " ODD!" : "",
                     arousal, habituation, excess, idleFor, (unsigned)curBright, sleepT,
                     vbusGood ? "USB" : "BAT",
                     sLean.x * 57.2958f, sSx.x, sSy.x,
                     touching ? 1 : 0, pressingBody ? 1 : 0,
                     touchX, touchY, touchFor,
                     faceDown ? " FACEDOWN" : "",
                     handled ? " HANDLED" : "",
                     freefall ? " FREEFALL" : "", impact ? " IMPACT" : "");
    USBSerial.printf("  potato | \"%s\" | batt %d%% %dmV chg %d vbus %d chgset %dmA | %s alone %.0fs%s%s%s%s | events %u | "
                     "net %s hb %lu fail %lu rev %d unread %d%s | text %lums | heap %luk\n",
                     uiLine, battery.pct, battery.mv, battery.charging ? 1 : 0, battery.vbus ? 1 : 0,
                     chargeCurrentMa,
                     orientationNow, sinceHandledS, sessionActive ? " SESSION" : "",
                     inDark ? (darkAnnounced ? " DARK" : " dark?") : "", inCeiling ? " CEILING" : "",
                     inTransit ? " TRANSIT" : "", events.count,
                     net.status, (unsigned long)net.heartbeats, (unsigned long)net.failures,
                     sceneRev, fileUnread, request.active ? " REQUEST" : "",
                     (unsigned long)(uiFlushUs / 1000),
                     (unsigned long)(heap_caps_get_free_size(MALLOC_CAP_INTERNAL) / 1024));
    uiFlushUs = 0;
    // Orientation calibration. Hold the board the way you want the potato to
    // stand and read this line.
    if (conf > 0.90f && !handled) {
      const float leanDeg = rawLean * 57.2958f;
      const int off = (int)lroundf(leanDeg / 90.0f);
      const int suggest = ((ACC_ROT - off) % 4 + 4) % 4;
      if (suggest != ACC_ROT) {
        USBSerial.printf("  calibrate: upright reads %.0fdeg — set ACC_ROT %d (currently %d)\n",
                         leanDeg, suggest, ACC_ROT);
      } else if (fabsf(leanDeg) > 25.0f) {
        USBSerial.printf("  calibrate: upright reads %.0fdeg — between quarter turns, "
                         "hold it square to gravity\n", leanDeg);
      }
    }

    frames = 0;
    lastLogMs = nowMs;
  }

  const uint32_t spent = micros() - frameStart;
  if (spent < FRAME_US) {
    const uint32_t left = FRAME_US - spent;
    if (left > 1500) delay(left / 1000); else delayMicroseconds(left);
  }
}
