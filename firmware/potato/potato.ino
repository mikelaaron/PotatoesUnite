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

#define FW_VERSION "0.1.0"

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
static float saccadeIn = 1.0f;
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
static uint32_t sessionStartMs = 0, sessionLastActiveMs = 0;
static float sessionQuietS = 0.0f;
static uint8_t sessionLifts = 0;
static uint32_t lastSessionEndMs = 0;   // 0 = never
static uint32_t lastMinorLineMs = 0;
static bool minorLineEver = false;
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
  strncpy(sceneLine, sd.line, MAX_LINE - 1);
  sceneLine[MAX_LINE - 1] = 0;
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

// ------------------------------------------------------------------ setup ---

void setup() {
  USBSerial.begin(115200);
  USBSerial.setTxTimeoutMs(0);

  Wire.begin(IIC_SDA, IIC_SCL);

  // Reset pulse for display and touch. Not required to light the panel, but it
  // makes cold starts deterministic.
  if (expander.begin(IO_EXPANDER_ADDR)) {
    for (uint8_t p = 0; p < 3; ++p) expander.pinMode(p, OUTPUT);
    for (uint8_t p = 0; p < 3; ++p) expander.digitalWrite(p, LOW);
    delay(20);
    for (uint8_t p = 0; p < 3; ++p) expander.digitalWrite(p, HIGH);
    delay(20);
  } else {
    USBSerial.println("XCA9554 not found at 0x20 — continuing without reset pulse");
  }

  uint8_t touchChipId = 0xFF;
  touchReady = probeTouch(&touchChipId);
  if (touchReady) {
    USBSerial.printf("touch ready at 0x%02x: chip id 0x%02x\n",
                     CST820_ADDR, touchChipId);
  } else {
    USBSerial.println("CST820 touch not found at 0x15 — continuing without touch");
  }

  powerReady = power.begin(Wire, AXP2101_SLAVE_ADDRESS, IIC_SDA, IIC_SCL);
  if (powerReady) {
    if (!readVbusGood(&vbusGood)) vbusGood = USBSerial.isPlugged();
    vbusCandidate = vbusGood;
    USBSerial.printf("AXP2101 ready: external power %s\n", vbusGood ? "present" : "absent");
  } else {
    // HWCDC sees a computer host without depending on DTR/RTS. It does not see
    // a charge-only adapter, so it is only a fallback when the PMU is missing.
    vbusGood = USBSerial.isPlugged();
    vbusCandidate = vbusGood;
    USBSerial.printf("AXP2101 not found — USB-host fallback says %s\n",
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
  qmi.configAccelerometer(SensorQMI8658::ACC_RANGE_4G,
                          SensorQMI8658::ACC_ODR_1000Hz,
                          SensorQMI8658::LPF_MODE_0);
  qmi.enableAccelerometer();
  qmi.configGyroscope(SensorQMI8658::GYR_RANGE_512DPS,
                      SensorQMI8658::GYR_ODR_224_2Hz,
                      SensorQMI8658::LPF_MODE_0);
  qmi.enableGyroscope();

  if (powerReady) {
    power.enableBattDetection();
    power.enableBattVoltageMeasure();
    power.enableVbusVoltageMeasure();
    power.enableSystemVoltageMeasure();
    chargeCurrentMa = chgCurMa(power.getChargerConstantCurr());
    USBSerial.printf("power: charge current setting %d mA (left unchanged)\n", chargeCurrentMa);
  }
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
  saccadeIn = frange(T.saccadeMin, T.saccadeMax);

  bootMs = millis();
  USBSerial.printf("potato up. fw %s. russet, %dx%d. It has eyes.\n",
                   FW_VERSION, (int)SHAPE.rx, (int)SHAPE.ry);
}

// Development-only: type a key in the serial monitor to exercise the same
// state and render paths as the physical triggers, without claiming to
// validate the sensors. Lower case only; 'h' lists them.
static void serialCommand(int c) {
  switch (c) {
    case 't': sayPool(POOL_TAP); postEvent(EV_TAP); break;
    case 'n': sayNight(); break;
    case 'p': sayPool(POOL_PICKUP); postEvent(EV_PICKUP); break;
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
    case 'b': netRequestHeartbeat(); USBSerial.println("heartbeat requested"); break;
    case 'i':
      USBSerial.printf("identity: %s, %s #%s %s claim %s seed %08lx | net %s hb %lu fail %lu rev %d | server %s tz %s\n",
                       identity.registered ? "registered" : "not registered", identity.name,
                       identity.potatoId, identity.variety, identity.claim, (unsigned long)poolSeed,
                       net.status, (unsigned long)net.heartbeats, (unsigned long)net.failures,
                       sceneRev, serverUrl, tzString);
      break;
    case 'W': netForgetWifi(); break;
    case 'R': netReregister(); break;
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
      USBSerial.println("keys: t tap, n night, p pickup, d drop, k dark-restored, q demo Question, 1/2/3 press a button, x clear, a aggrieved, w pleased, z asleep, v waiting, e events, c claim, b heartbeat, i identity, m ration state, W forget wifi, R register again");
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

  const bool freefall = amag < FREEFALL_G;
  const bool impact = amag > IMPACT_G;
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

  // The PMU answers "external VBUS is good" even for charge-only adapters.
  // Require two consecutive changed samples so one I2C miss cannot switch the
  // power policy. If the PMU is absent, HWCDC still detects a computer host.
  const uint32_t powerNowMs = millis();
  if (powerNowMs - lastPowerPollMs >= 1000) {
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
    if (sampleValid) {
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
    lastPowerPollMs = powerNowMs;
  }

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
    static const float ALONE_T[6] = {4 * 3600.0f, 8 * 3600.0f, 24 * 3600.0f,
                                     48 * 3600.0f, 72 * 3600.0f, 7 * 86400.0f};
    static const char *const ALONE_L[6] = {LINE_ALONE_4H, LINE_ALONE_8H, LINE_ALONE_24H,
                                           LINE_ALONE_48H, LINE_ALONE_72H, LINE_ALONE_7D};
    if (aloneStage < 6 && sinceHandledS >= ALONE_T[aloneStage]) {
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
      sessionStartMs = tNow;
      sessionLifts = 1;
      sessionQuietS = 0.0f;
      const bool tenMinOk = (lastSessionEndMs == 0) ||
                            (int32_t)(tNow - lastSessionEndMs) >= 600000;
      if (!dropRecent && tenMinOk && minorLineAllowed(tNow)) {
        const uint32_t away = lastSessionEndMs == 0 ? 0 : (tNow - lastSessionEndMs) / 1000;
        if (away >= 24 * 3600) say(LINE_RETURN_LONG, REACTION_S);
        else if (away >= 4 * 3600) say(LINE_RETURN, REACTION_S);
        else sayPool(POOL_PICKUP);
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
      // Put-down speaks only after a session of 30 s or more, one time in
      // three, and only if the minor budget allows.
      if (durS >= 30 && !inDark && seededRoll() < 0.3333f && minorLineAllowed(tNow)) {
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
    if (!inPeak && jolt > 0.9f) {
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
  if (powerReady && tNow - lastBatteryPollMs >= 5000) {
    lastBatteryPollMs = tNow;
    battery.present = power.isBatteryConnect();
    battery.pct = battery.present ? power.getBatteryPercent() : -1;
    battery.mv = battery.present ? (int)power.getBattVoltage() : -1;
    battery.charging = power.isCharging();
    battery.vbus = power.isVbusIn();
    if (battery.present && battery.pct >= 0) {
      if (vbusStable) {
        if (!battFullSaid && battery.pct >= 100) { battFullSaid = true; say(LINE_FULL, REACTION_S); }
      } else {
        // Downward crossings only, once per discharge, and — because vbusStable
        // is false only after 60 s off power — never on a cable blip. Major
        // lines, so they bypass the minor budget.
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
    }
  }

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
  const bool wantDark = (sleepT > 0.97f) || (!vbusGood && idleFor > DARK_AFTER_S);

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
  } else if (fileUnread > 0) {
    // The File has entries. Eyes toward the nearest screen edge.
    gazeTX = sDrift.x >= 0.0f ? 1.0f : -1.0f;
    gazeTY = 0.15f;
  } else {
    saccadeIn -= dt;
    if (saccadeIn <= 0.0f) {
      saccadeIn = frange(T.saccadeMin, T.saccadeMax) * (1.0f - arousal * 0.55f);
      // Stirred, it looks at you rather than wandering.
      const float wander = (1.0f - arousal);
      gazeTX = frange(-1.0f, 1.0f) * wander;
      gazeTY = frange(-0.6f, 0.6f) * wander;
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
