// paper — the e-paper press. A citizen that also prints the paper.
//
// Waveshare ESP32-S3-ePaper-1.54G: 200x200 four-colour e-paper, SHTC3,
// PCF85063, ES8311 (unused), ETA6098 charger (no telemetry), BOOT and PWR
// keys, a green LED, and a GPIO17 power latch that must go HIGH before
// anything else or the board turns itself off on battery.
//
// It registers as board "epaper154", heartbeats every 120 s and after a key
// press, and prints the Bulletin: masthead, headline, two items, and its own
// scene line beside its portrait. When the Question is open the lower half
// is the Question; a short BOOT press moves the cursor, a long press votes.
// It is the potato that never gets picked up: orientation is always "up",
// handling is the BOOT key, and the only event it ever sends is `tap`.

#define FW_VERSION "0.1.0"

#include <Arduino.h>
#include <Wire.h>
#include <Preferences.h>
#include <time.h>
#include <sys/time.h>
#include <math.h>
#include "driver/gpio.h"
#include "esp_sntp.h"
#include "HWCDC.h"

#include "board_pins.h"
#include "keys.h"
#include "epd154g.h"
#include "sensors.h"
#include "paper_gfx.h"
#include "layout.h"
#include "events.h"
#include "protocol.h"
#include "net.h"

HWCDC USBSerial;

static Preferences prefs;
static EventQueue events;
static Epd154g epd;
static PaperCanvas canvas;
static uint8_t shadow[PAPER_BYTES];          // what the panel task sends
static uint8_t sendBuf[PAPER_BYTES];         // rotated copy, if the panel is upside down
static PaperModel model;

static SceneData scene;
static bool haveScene = false;
static int sceneRev = 0;
static char choiceIds[MAX_CHOICES][24];
static int8_t cursor = 0;
static int8_t chosen = -1;
static char chosenId[24];
static char lastChoiceSig[96];

static uint32_t bootMs = 0;
static uint32_t lastHandledMs = 0;
static uint32_t heartbeatDueMs = 0;
static uint32_t showClaimUntilMs = 0;
static uint32_t lastPressMs = 0;
static uint32_t ledOffAtMs = 0;
static bool forceRefresh = false;
static bool nightOverride = false;           // dev: pretend it is night

static bool shtOk = false;
static uint16_t shtId = 0;
static bool haveTemp = false;
static float tempRawC = 0.0f, humidity = 0.0f;
static bool rtcOk = false;
static bool clockFromRtc = false;
static volatile bool ntpSynced = false;
static bool rtcSetFromNtp = false;
static float battV = 0.0f;
static int battPct = 0;
static bool vbus = false, charging = false;

// The panel task. The loop renders into `canvas`; when a refresh is due it
// copies into `shadow` and raises `refreshPending`; the task spends the
// 15-20 s in the panel's BUSY wait so the keys and the Net keep running.
static volatile bool refreshPending = false;
static volatile bool refreshing = false;
static volatile uint32_t lastRefreshMs = 0;
static volatile long lastRefreshTookMs = 0;
static volatile int refreshCount = 0;
static bool everRefreshed = false;
static uint32_t shownHash = 0;
static char shownHeadline[80];

// ------------------------------------------------------------------ power ---

// Drive the latch HIGH before anything else. A previous firmware may have
// left the pad held; configure HIGH first, then release the hold, then hold
// it again so a soft reset on battery does not dip the pin and power us off.
static void latchPower() {
  pinMode(VBAT_PWR_PIN, OUTPUT);
  digitalWrite(VBAT_PWR_PIN, HIGH);
  gpio_hold_dis((gpio_num_t)VBAT_PWR_PIN);
  digitalWrite(VBAT_PWR_PIN, HIGH);
  gpio_hold_en((gpio_num_t)VBAT_PWR_PIN);
}

static void powerOff() {
  USBSerial.println("power: PWR key held — releasing the latch (on USB this does nothing)");
  USBSerial.flush();
  delay(50);
  gpio_hold_dis((gpio_num_t)VBAT_PWR_PIN);
  digitalWrite(VBAT_PWR_PIN, LOW);
  delay(500);
  USBSerial.println("power: still here, so VSYS is on USB. Carrying on.");
}

static inline void ledOn() { digitalWrite(LED_PIN, LOW); }
static inline void ledOff() { digitalWrite(LED_PIN, HIGH); }
static void ledBlink(uint32_t ms) { ledOn(); ledOffAtMs = millis() + ms; }

// ------------------------------------------------------------------- time ---

static inline bool clockSet() { return time(nullptr) > 1700000000; }

static bool localNow(struct tm *lt) {
  if (!clockSet()) return false;
  const time_t now = time(nullptr);
  localtime_r(&now, lt);
  return true;
}

// Minutes east of UTC, from the two calendars rather than tm_gmtoff.
static int utcOffsetMin() {
  const time_t now = time(nullptr);
  struct tm g, l;
  gmtime_r(&now, &g);
  localtime_r(&now, &l);
  int off = (l.tm_hour * 60 + l.tm_min) - (g.tm_hour * 60 + g.tm_min);
  int dd = l.tm_yday - g.tm_yday;
  if (dd > 1) dd = -1; else if (dd < -1) dd = 1;
  return off + dd * 1440;
}

static bool isNight() {
  if (nightOverride) return true;
  struct tm lt;
  if (!localNow(&lt)) return false;
  return lt.tm_hour >= 23 || lt.tm_hour < 6;
}

// ----------------------------------------------------------------- events ---

static void postEvent(EventType t, int32_t v = 0) {
  events.push(millis(), t, v);
  heartbeatDueMs = millis() + 1500;
  USBSerial.printf("event: %s (%u queued)\n", EVENT_NAMES[t], events.count);
}

// ------------------------------------------------------------------ scene ---

static const BulletinData *pickBulletin() {
  if (!haveScene) return nullptr;
  struct tm lt;
  if (localNow(&lt)) {
    const int mins = lt.tm_hour * 60 + lt.tm_min;
    if (mins >= 18 * 60 + 30) {
      if (scene.evening.present) return &scene.evening;
      if (scene.morning.present) return &scene.morning;
    } else if (mins >= 7 * 60 + 30) {
      if (scene.morning.present) return &scene.morning;
    }
  }
  return scene.bulletin.present ? &scene.bulletin : nullptr;
}

static PortraitDither ditherForVariety(const char *v) {
  // assets/varieties.json, "dither".
  if (!strcmp(v, "russet") || !strcmp(v, "purple_majesty")) return DITHER_COARSE;
  if (!strcmp(v, "yukon_gold") || !strcmp(v, "kennebec")) return DITHER_FINE;
  if (!strcmp(v, "red") || !strcmp(v, "king_edward") || !strcmp(v, "desiree")) return DITHER_MEDIUM;
  return DITHER_NONE;   // fingerling, maris_piper, charlotte
}

static void buildModel() {
  memset(&model, 0, sizeof(model));
  const BulletinData *b = pickBulletin();
  if (b) {
    model.hasBulletin = true;
    model.no = b->no;
    asciiFold(b->edition, model.edition, sizeof(model.edition));
    for (char *c = model.edition; *c; ++c) if (*c >= 'a' && *c <= 'z') *c = (char)(*c - 'a' + 'A');
    asciiFold(b->headline, model.headline, sizeof(model.headline));
    model.nItems = b->nItems;
    for (int i = 0; i < b->nItems; ++i) asciiFold(b->items[i], model.items[i], sizeof(model.items[i]));
  }
  model.incident = haveScene && !strcmp(scene.cue, "incident");
  asciiFold(haveScene ? scene.line : "", model.line, sizeof(model.line));
  strncpy(model.name, identity.name, sizeof(model.name) - 1);
  strncpy(model.variety, identity.variety, sizeof(model.variety) - 1);
  strncpy(model.potatoId, identity.potatoId, sizeof(model.potatoId) - 1);
  strncpy(model.claim, identity.claim, sizeof(model.claim) - 1);
  model.showClaim = showClaimUntilMs && (int32_t)(millis() - showClaimUntilMs) < 0;
  model.dither = ditherForVariety(identity.variety);
  if (haveScene) {
    switch (scene.expression) {
      case EXPR_AGGRIEVED: case EXPR_WAITING: model.eyes = 1; break;
      case EXPR_ASLEEP: case EXPR_DORMANT: case EXPR_SPROUTED: model.eyes = 2; break;
      default: model.eyes = 0; break;
    }
  }
  if (haveScene && scene.nChoices > 0) {
    model.question = true;
    strncpy(model.qText, model.line, sizeof(model.qText) - 1);
    model.nOptions = scene.nChoices;
    for (int i = 0; i < scene.nChoices; ++i) asciiFold(scene.choices[i].label, model.options[i], sizeof(model.options[i]));
    model.cursor = cursor;
    model.chosen = chosen;
  }
  char status[48];
  { NetLock l; strncpy(status, net.status, sizeof(status) - 1); status[sizeof(status) - 1] = 0; }
  if (!strcmp(status, "portal")) snprintf(model.status, sizeof(model.status), "JOIN %s", apName);
  else if (strcmp(status, "online") != 0) strncpy(model.status, "NO NET", sizeof(model.status) - 1);
  else if (!identity.registered) strncpy(model.status, "REGISTERING", sizeof(model.status) - 1);
}

static void applySceneJson(const char *json) {
  static SceneData sd;
  if (!parseScene(json, sd)) { USBSerial.println("scene: bad json"); return; }
  scene = sd;
  haveScene = true;
  sceneRev = scene.rev;
  { NetLock l; net.revSeen = sceneRev; }

  // A new set of choices resets the cursor; the same set keeps it and the vote.
  char sig[96] = "";
  for (int i = 0; i < scene.nChoices; ++i) {
    strncat(sig, scene.choices[i].id, sizeof(sig) - strlen(sig) - 2);
    strncat(sig, "|", sizeof(sig) - strlen(sig) - 1);
  }
  if (strcmp(sig, lastChoiceSig) != 0) {
    strncpy(lastChoiceSig, sig, sizeof(lastChoiceSig) - 1);
    cursor = 0;
    chosen = -1;
    for (int i = 0; i < scene.nChoices; ++i) {
      strncpy(choiceIds[i], scene.choices[i].id, sizeof(choiceIds[i]) - 1);
      if (chosenId[0] && !strcmp(chosenId, scene.choices[i].id)) chosen = (int8_t)i;
    }
    if (scene.nChoices == 0) chosenId[0] = 0;
  }
  const BulletinData *b = pickBulletin();
  USBSerial.printf("scene: rev %d %s \"%s\" choices %u cue %s unread %d | bulletin %s | today: morning %s, evening %s\n",
                   sceneRev, scene.expressionName, scene.line, (unsigned)scene.nChoices, scene.cue, scene.fileUnread,
                   scene.bulletin.present ? scene.bulletin.headline : "none",
                   scene.morning.present ? "yes" : "no", scene.evening.present ? "yes" : "no");
  if (b) USBSerial.printf("scene: printing No. %d %s \"%s\" (%u items)\n", b->no, b->edition, b->headline, (unsigned)b->nItems);
}

// Loop side of the Net: pick up what the task left.
static void netPoll(uint32_t tNow) {
  static char json[SCENE_JSON_CAP];
  bool sceneFresh = false, claimFresh = false, wifiLost = false, wifiBack = false, dormant = false, statusFresh = false;
  uint32_t backDur = 0, dormDur = 0;
  char statusLine[MAX_LINE];
  {
    NetLock l;
    if (net.sceneFresh) { memcpy(json, net.sceneJson, SCENE_JSON_CAP); net.sceneFresh = false; sceneFresh = true; }
    claimFresh = net.claimFresh; net.claimFresh = false;
    wifiLost = net.wifiLost; net.wifiLost = false;
    wifiBack = net.wifiBack; net.wifiBack = false; backDur = net.wifiBackDurS;
    dormant = net.dormantFresh; net.dormantFresh = false; dormDur = net.dormantDurS;
    if (net.statusLineFresh) { strncpy(statusLine, net.statusLine, MAX_LINE - 1); statusLine[MAX_LINE - 1] = 0; net.statusLineFresh = false; statusFresh = true; }
  }
  if (sceneFresh) applySceneJson(json);
  if (claimFresh) {
    showClaimUntilMs = tNow + 600000;
    USBSerial.printf("identity: claim code %s in the footer for 10 min\n", identity.claim);
  }
  if (wifiLost) USBSerial.println("net: lost");
  if (wifiBack) postEvent(EV_WIFI_RESTORE, (int32_t)backDur);
  if (dormant) postEvent(EV_DORMANT_RESUME, (int32_t)dormDur);
  if (statusFresh) USBSerial.printf("net status line: \"%s\"\n", statusLine);

  if (heartbeatDueMs && (int32_t)(tNow - heartbeatDueMs) >= 0) {
    heartbeatDueMs = 0;
    netRequestHeartbeat();
  }

  // The RTC follows NTP once; the system clock follows the RTC at boot.
  if (ntpSynced && !rtcSetFromNtp && rtcOk) {
    rtcSetFromNtp = true;
    const time_t now = time(nullptr);
    struct tm g;
    gmtime_r(&now, &g);
    USBSerial.printf("rtc: set from NTP, %04d-%02d-%02d %02d:%02d:%02d UTC (%s)\n", g.tm_year + 1900, g.tm_mon + 1, g.tm_mday,
                     g.tm_hour, g.tm_min, g.tm_sec, rtcWrite(g) ? "ok" : "write failed");
  }

  static uint32_t lastSnapshotMs = 0;
  if (tNow - lastSnapshotMs >= 1000) {
    lastSnapshotMs = tNow;
    const bool hasOff = clockSet();
    netUpdateSnapshot(battPct, charging, vbus, "up", (tNow - lastHandledMs) / 1000,
                      haveTemp, tempRawC - SHTC3_BOARD_HEAT_C, hasOff, hasOff ? utcOffsetMin() : 0);
  }
}

// ------------------------------------------------------------------- keys ---

static void vote(int idx) {
  if (!haveScene || idx < 0 || idx >= scene.nChoices) return;
  chosen = (int8_t)idx;
  strncpy(chosenId, choiceIds[idx], sizeof(chosenId) - 1);
  USBSerial.printf("choice: id=%s label=\"%s\" rev=%d\n", choiceIds[idx], scene.choices[idx].label, sceneRev);
  if (identity.registered) netSendChoice(sceneRev, choiceIds[idx]);
}

static void bootShort() {
  lastHandledMs = millis();
  lastPressMs = millis();
  ledBlink(120);
  if (haveScene && scene.nChoices > 0) {
    cursor = (int8_t)((cursor + 1) % scene.nChoices);
    USBSerial.printf("key: BOOT short — cursor %d \"%s\"\n", cursor, scene.choices[cursor].label);
  } else {
    USBSerial.println("key: BOOT short — tap");
  }
  postEvent(EV_TAP);
  forceRefresh = true;
}

static void bootLong() {
  lastHandledMs = millis();
  lastPressMs = millis();
  ledBlink(400);
  if (haveScene && scene.nChoices > 0) {
    USBSerial.printf("key: BOOT long — vote %d\n", cursor);
    vote(cursor);
  } else {
    showClaimUntilMs = millis() + 600000;
    USBSerial.printf("key: BOOT long — claim code %s in the footer for 10 min\n", identity.claim[0] ? identity.claim : "(none yet)");
  }
  forceRefresh = true;
}

static Key bootKey = {BOOT_BUTTON_PIN, false, 0, false, 0};
static Key pwrKey = {PWR_BUTTON_PIN, false, 0, false, 0};

static void pollKey(Key &k, uint32_t now, uint32_t longMs, void (*onShort)(), void (*onLong)()) {
  const bool pressed = digitalRead(k.pin) == LOW;
  if (pressed != k.down && now - k.lastEdgeMs >= 30) {
    k.lastEdgeMs = now;
    k.down = pressed;
    if (pressed) { k.downMs = now; k.longFired = false; }
    else if (!k.longFired && now - k.downMs >= 30) onShort();
  }
  if (k.down && !k.longFired && now - k.downMs >= longMs) { k.longFired = true; onLong(); }
}

// ------------------------------------------------------------------ panel ---

static void displayTask(void *arg) {
  (void)arg;
  for (;;) {
    if (refreshPending) {
      refreshPending = false;
      refreshing = true;
      ledOn();
      const uint8_t *frame = shadow;
#if EPD_ROTATE_180
      rotate180(shadow, sendBuf);
      frame = sendBuf;
#endif
      const long took = epd.show(frame);
      lastRefreshTookMs = took;
      lastRefreshMs = millis();
      ++refreshCount;
      ledOff();
      refreshing = false;
      if (took >= 0) USBSerial.printf("epd: refresh #%d done in %ld ms (%s)%s\n", refreshCount, took, epd.hwSpi ? "fspi" : "bitbang",
                                      epd.lastWentBusy ? "" : " — but BUSY never asserted: the panel did not take the frame");
      else USBSerial.printf("epd: refresh #%d — BUSY never released (%ld ms); check the panel and GP8\n", refreshCount, -took);
    }
    vTaskDelay(pdMS_TO_TICKS(50));
  }
}

// Full refresh only when the page would change, never more than once a
// minute, never 23:00-06:00 local unless the headline changed. A key press
// gets the panel as soon as it is idle and the Hands have stopped pressing
// (2 s), because a Question you cannot see yourself answering is no
// Question. The first page waits up to 20 s for the Net so it is the real one.
static void considerRefresh(uint32_t now, const char *why) {
  if (refreshing || refreshPending) return;
  buildModel();
  renderPaper(canvas, model, nullptr);
  const uint32_t h = canvas.hash();
  const bool changed = h != shownHash || !everRefreshed;
  if (!changed && !forceRefresh) return;
  if (lastPressMs && now - lastPressMs < 2000) return;
  const char *head = model.hasBulletin ? model.headline : "";
  const bool headlineChanged = strcmp(head, shownHeadline) != 0;
  bool interaction = forceRefresh;
  if (!interaction && everRefreshed) {
    if (now - lastRefreshMs < 60000) return;
    if (isNight() && !headlineChanged) return;
  }
  if (!everRefreshed && !haveScene && now - bootMs < 20000 && !forceRefresh) return;
  if (!changed && forceRefresh) { forceRefresh = false; return; }   // a key that changed nothing visible

  PaperLog log;
  renderPaper(canvas, model, &log);
  memcpy(shadow, canvas.buf, PAPER_BYTES);
  shownHash = h;
  strncpy(shownHeadline, head, sizeof(shownHeadline) - 1);
  everRefreshed = true;
  forceRefresh = false;
  refreshPending = true;
  USBSerial.printf("paper: printing (%s%s%s) hash %08lx\n%s", why, interaction ? ", key" : "",
                   headlineChanged ? ", new headline" : "", (unsigned long)h, log.text);
}

// ---------------------------------------------------------------- sensors ---

static void readSensors(uint32_t now) {
  static uint32_t lastTempMs = 0, lastBattMs = 0;
  if (shtOk && (lastTempMs == 0 || now - lastTempMs >= 30000)) {
    lastTempMs = now;
    float t, rh;
    if (shtc3Read(&t, &rh)) { tempRawC = t; humidity = rh; haveTemp = true; }
    else USBSerial.println("shtc3: read failed");
  }
  if (lastBattMs == 0 || now - lastBattMs >= 10000) {
    lastBattMs = now;
    battV = batteryVolts();
    battPct = batteryPct(battV);
    // The charger exposes nothing, so: a USB host on the CDC, or a cell held
    // above 4.15 V (the charger's CV phase), means external power.
    vbus = USBSerial.isPlugged() || battV >= 4.15f;
    charging = vbus && battPct < 100;
  }
}

// ------------------------------------------------------------------ setup ---

void setup() {
  latchPower();                        // first, before the PWR key is released
  pinMode(LED_PIN, OUTPUT);
  ledOn();
  pinMode(EPD_PWR_PIN, OUTPUT);
  digitalWrite(EPD_PWR_PIN, LOW);      // panel rail on
  pinMode(BOOT_BUTTON_PIN, INPUT_PULLUP);
  pinMode(PWR_BUTTON_PIN, INPUT_PULLUP);
  bootMs = millis();
  lastHandledMs = bootMs;

  USBSerial.begin(115200);
  USBSerial.setTxTimeoutMs(0);
  USBSerial.printf("\npaper up. fw %s, board epaper154. GP17 latch HIGH and held.\n", FW_VERSION);

  Wire.begin(I2C_SDA_PIN, I2C_SCL_PIN);
  shtOk = shtc3Probe(&shtId);
  if (shtOk) {
    float t, rh;
    if (shtc3Read(&t, &rh)) {
      tempRawC = t; humidity = rh; haveTemp = true;
      USBSerial.printf("shtc3: id 0x%04x, %.1f C raw (%.1f C after the %.0f C board-heat offset), %.0f%% RH\n",
                       shtId, t, t - SHTC3_BOARD_HEAT_C, SHTC3_BOARD_HEAT_C, rh);
    } else {
      USBSerial.printf("shtc3: id 0x%04x but the first read failed\n", shtId);
    }
  } else {
    USBSerial.println("shtc3: not found at 0x70 — no temp_c");
  }

  rtcOk = rtcPresent();
  if (rtcOk) {
    struct tm t;
    if (rtcRead(&t)) {
      struct timeval tv = {mktime(&t), 0};   // TZ is not set yet, so mktime is UTC
      settimeofday(&tv, nullptr);
      clockFromRtc = true;
      USBSerial.printf("rtc: pcf85063 %04d-%02d-%02d %02d:%02d:%02d UTC — system clock set from it\n",
                       t.tm_year + 1900, t.tm_mon + 1, t.tm_mday, t.tm_hour, t.tm_min, t.tm_sec);
    } else {
      USBSerial.println("rtc: pcf85063 present, time not valid (oscillator stopped) — waiting for NTP");
    }
  } else {
    USBSerial.println("rtc: pcf85063 not found at 0x51");
  }

  analogSetPinAttenuation(BAT_ADC_PIN, ADC_11db);
  readSensors(millis());
  USBSerial.printf("battery: %.2f V (%d%%), %s; charger has no telemetry, vbus inferred\n", battV, battPct,
                   vbus ? "external power" : "on the cell");

  prefs.begin("potato", false);
  esp_sntp_set_time_sync_notification_cb([](struct timeval *) { ntpSynced = true; });
  netBegin(prefs, &events);
  setenv("TZ", tzString, 1);
  tzset();
  if (clockFromRtc) {
    struct tm lt;
    if (localNow(&lt)) USBSerial.printf("clock: local %02d:%02d (%s)\n", lt.tm_hour, lt.tm_min, tzString);
  }

  epd.begin();
  USBSerial.printf("epd: 1.54 G on FSPI sck %d mosi %d cs %d dc %d rst %d busy %d (busy now: %s)%s\n",
                   EPD_SCK_PIN, EPD_MOSI_PIN, EPD_CS_PIN, EPD_DC_PIN, EPD_RST_PIN, EPD_BUSY_PIN,
                   epd.busy() ? "yes" : "no", EPD_ROTATE_180 ? ", rotated 180" : "");
  xTaskCreatePinnedToCore(displayTask, "epd", 4096, nullptr, 1, nullptr, 1);
  ledOff();
  USBSerial.println("keys: BOOT short = tap / cursor, BOOT long (1.5 s) = vote / claim code, PWR long (3 s) = power off. 'h' for serial keys.");
}

// ---------------------------------------------------------------- serial ---

static void demoQuestion() {
  static const char *demo =
      "{\"rev\":9999,\"expression\":\"waiting\",\"line\":\"Ketchup. Which would you least object to being served with?\","
      "\"choices\":[{\"id\":\"heinz\",\"label\":\"HEINZ\"},{\"id\":\"hunts\",\"label\":\"HUNT'S\"},{\"id\":\"whatever\",\"label\":\"WHATEVER'S THERE\"}],"
      "\"cue\":\"none\",\"file_unread\":0,\"request\":null,"
      "\"bulletin\":{\"no\":1,\"edition\":\"morning\",\"headline\":\"THE NET IS LIVE.\",\"items\":[\"Population: 14. All 14 are new. Nobody knows what they're doing. This is normal.\",\"Today's Question: ketchup. Polls close at 23:00 UTC.\"]},"
      "\"bulletins\":{\"morning\":null,\"evening\":null}}";
  applySceneJson(demo);
  USBSerial.println("scene: demo Question loaded (not from the Net; 'b' fetches the real one)");
}

static void serialCommand(int c) {
  switch (c) {
    case 't': bootShort(); break;
    case 'l': bootLong(); break;
    case 'q': demoQuestion(); break;
    case 'b': netRequestHeartbeat(); USBSerial.println("heartbeat requested"); break;
    case 'r': forceRefresh = true; USBSerial.println("refresh forced"); break;
    case 'n': nightOverride = !nightOverride; USBSerial.printf("night override %s\n", nightOverride ? "on" : "off"); break;
    case 'p': {
      buildModel();
      PaperLog log;
      renderPaper(canvas, model, &log);
      USBSerial.printf("page (hash %08lx, shown %08lx):\n%s", (unsigned long)canvas.hash(), (unsigned long)shownHash, log.text);
      break;
    }
    case 's': case 'S': {
      buildModel();
      renderPaper(canvas, model, nullptr);
      USBSerial.printf("screen %s:\n", c == 's' ? "100x100 (2x2 cells)" : "200x200");
      dumpCanvas(canvas, c == 's' ? 2 : 1, [](const char *l) { USBSerial.println(l); });
      break;
    }
    case 'T': {
      float t, rh;
      if (shtOk && shtc3Read(&t, &rh)) USBSerial.printf("shtc3: %.2f C raw, %.2f C compensated, %.1f%% RH\n", t, t - SHTC3_BOARD_HEAT_C, rh);
      else USBSerial.println("shtc3: read failed");
      USBSerial.printf("battery: %.3f V (%d%%) vbus %d charging %d | usb host %d\n", batteryVolts(), batteryPct(batteryVolts()), vbus, charging, USBSerial.isPlugged());
      break;
    }
    case 'c': {
      const time_t now = time(nullptr);
      struct tm g, l, r;
      gmtime_r(&now, &g); localtime_r(&now, &l);
      const bool rv = rtcOk && rtcRead(&r);
      USBSerial.printf("clock: utc %02d:%02d:%02d local %02d:%02d:%02d offset %d min | set %s | rtc %s%02d:%02d:%02d | night %s\n",
                       g.tm_hour, g.tm_min, g.tm_sec, l.tm_hour, l.tm_min, l.tm_sec, clockSet() ? utcOffsetMin() : 0,
                       ntpSynced ? "by NTP" : clockFromRtc ? "from RTC" : "not yet", rv ? "" : "invalid ", rv ? r.tm_hour : 0,
                       rv ? r.tm_min : 0, rv ? r.tm_sec : 0, isNight() ? "yes" : "no");
      break;
    }
    case 'e':
      USBSerial.printf("events queued %u dropped %lu:", events.count, (unsigned long)events.dropped);
      for (int i = 0; i < events.count; ++i) USBSerial.printf(" %s@%lus", EVENT_NAMES[events.at(i).type], (unsigned long)(events.at(i).ms / 1000));
      USBSerial.println();
      break;
    case 'i':
      USBSerial.printf("identity: %s, %s #%s %s claim %s seed %08lx | net %s hb %lu fail %lu rev %d | server %s tz %s | ap %s | refreshes %d last %ld ms\n",
                       identity.registered ? "registered" : "not registered", identity.name, identity.potatoId,
                       identity.variety, identity.claim, (unsigned long)identity.seed, net.status,
                       (unsigned long)net.heartbeats, (unsigned long)net.failures, sceneRev, serverUrl, tzString, apName,
                       refreshCount, (long)lastRefreshTookMs);
      break;
    case 'x': haveScene = false; chosen = -1; cursor = 0; forceRefresh = true; USBSerial.println("scene cleared"); break;
    case 'W': netForgetWifi(); break;
    case 'R': netReregister(); break;
    case 'O': powerOff(); break;
    case 'h':
      USBSerial.println("keys: t short press, l long press, q demo Question, b heartbeat, r force refresh, n night override, p page text, s/S screen dump, T sensors, c clock, e events, i identity, x clear scene, W forget wifi, R register again, O power off");
      break;
    default: break;
  }
}

// ------------------------------------------------------------------- loop ---

void loop() {
  const uint32_t now = millis();
  while (USBSerial.available()) serialCommand(USBSerial.read());

  pollKey(bootKey, now, 1500, bootShort, bootLong);
  pollKey(pwrKey, now, 3000, []() { USBSerial.println("key: PWR short — nothing; hold 3 s to power off"); }, powerOff);
  if (ledOffAtMs && (int32_t)(now - ledOffAtMs) >= 0 && !refreshing) { ledOff(); ledOffAtMs = 0; }

  readSensors(now);
  netPoll(now);

  static uint32_t lastConsiderMs = 0;
  if (now - lastConsiderMs >= 250) {
    lastConsiderMs = now;
    considerRefresh(now, haveScene ? "scene" : "no scene");
  }

  static uint32_t lastLogMs = 0;
  if (now - lastLogMs >= 60000) {
    lastLogMs = now;
    USBSerial.printf("tick: up %lus | %s hb %lu fail %lu rev %d | %.2f V %d%% vbus %d | %.1f C %.0f%% | refreshes %d | since handled %lus | events %u\n",
                     (unsigned long)(now / 1000), net.status, (unsigned long)net.heartbeats, (unsigned long)net.failures, sceneRev,
                     battV, battPct, vbus, tempRawC - SHTC3_BOARD_HEAT_C, humidity, refreshCount,
                     (unsigned long)((now - lastHandledMs) / 1000), events.count);
  }
  delay(5);
}
