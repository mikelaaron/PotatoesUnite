#pragma once

#include <WiFi.h>
#include <WiFiManager.h>
#include <HTTPClient.h>
#include <NetworkClientSecure.h>
#include <ESPmDNS.h>
#include <ArduinoJson.h>
#include <Preferences.h>
#include <time.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"
#include "esp_system.h"
#include "esp_random.h"
#include "HWCDC.h"
#include "esp_mac.h"
#include "events.h"
#include "protocol.h"
#include "../server_config.h"

// The Net. Protocol v0 (docs/PROTOCOL.md) over HTTP or HTTPS, from its own
// FreeRTOS task on core 0 so a slow server or an open captive portal never
// stalls the face on core 1. The loop and the task share one struct under
// one mutex; everything crossing is a copy, never a pointer into the other
// side's state.
//
// Never sent: raw audio, location, anything that is not in the protocol.
// The secret is generated on first boot, kept in NVS, and never shown.
//
// Copied from firmware/potato/net.h for the e-paper press. Differences: the
// board name, a larger scene cap (the Scene carries two Bulletin editions),
// and temp_c / utc_offset_min in the snapshot. Unify the two copies later.

// NO_SECRETS (set by `make webflash`) keeps dev credentials out of any image
// a stranger might flash: a public build must always open the portal.
#if __has_include("secrets.h") && !defined(NO_SECRETS)
#include "secrets.h"   // optional, gitignored: WIFI_SSID, WIFI_PASS, SERVER_URL
#endif

#ifndef SERVER_URL_DEFAULT
#define SERVER_URL_DEFAULT "http://potatoes.local:8080"
#endif
// POSIX TZ string. The device knows its offset; the server sends UTC.
#ifndef TZ_DEFAULT
#define TZ_DEFAULT "EST5EDT,M3.2.0,M11.1.0"
#endif

static const char *BOARD_NAME = "epaper154";
static const uint32_t HEARTBEAT_MS = 120000;
static const uint32_t HTTP_TIMEOUT_MS = 8000;
static const uint32_t PORTAL_TIMEOUT_S = 180;
static const int SCENE_JSON_CAP = 8192;   // a Scene with a bulletin and choices can grow
static const int SCENE_NVS_CAP = 3900;   // NVS strings top out near 4000 bytes

extern HWCDC USBSerial;

struct NetShared {
  // task -> loop
  bool sceneFresh;
  char sceneJson[SCENE_JSON_CAP];
  bool claimFresh;
  bool wifiLost, wifiBack;
  uint32_t wifiBackDurS;
  bool dormantFresh;
  uint32_t dormantDurS;
  bool statusLineFresh;
  char statusLine[MAX_LINE];   // shown when there is no scene (portal instructions)
  bool connecting;             // Wi-Fi is joining (secrets, saved creds, or a portal save): hold refreshes
  bool joinFailFresh;          // a portal save that did not connect
  char joinFailSsid[33];
  uint8_t joinFailCode;
  char status[48];             // one word for telemetry
  bool online, timeSynced, registered;
  bool lastHttpOk;             // the last register/heartbeat/choice got an answer
  uint32_t heartbeats, failures;
  // loop -> task
  bool wantHeartbeat;
  int revSeen;
  bool choicePending;
  int choiceRev;
  char choiceId[24];
  HeartbeatSnapshot snap;
  EventQueue *events;          // the loop's queue; touched only under the mutex
};

struct Identity {
  uint8_t secret[16];
  char secretHex[33];
  char potatoId[16];
  char name[32];
  char variety[24];
  uint32_t seed;
  char claim[16];
  bool registered;
};

static NetShared net;
static Identity identity;
static SemaphoreHandle_t netMtx = nullptr;
static Preferences netPrefs;          // the task's own handle on the same namespace
static char serverUrl[96] = SERVER_URL_DEFAULT;
static char tzString[64] = TZ_DEFAULT;
static char apName[16] = "POTATO-0000";
static uint32_t lastHeartbeatMs = 0;
static uint32_t wifiLostAtMs = 0;
static bool wasOnline = false;
static WiFiManager wm;
static WiFiManagerParameter *paramServer = nullptr;
static WiFiManagerParameter *paramTz = nullptr;

struct NetLock {
  NetLock() { xSemaphoreTake(netMtx, portMAX_DELAY); }
  ~NetLock() { xSemaphoreGive(netMtx); }
};

static void netSetStatus(const char *s) {
  NetLock l;
  strncpy(net.status, s, sizeof(net.status) - 1);
  net.status[sizeof(net.status) - 1] = 0;
}

static void netSetStatusLine(const char *s) {
  NetLock l;
  strncpy(net.statusLine, s, MAX_LINE - 1);
  net.statusLine[MAX_LINE - 1] = 0;
  net.statusLineFresh = true;
}

static void netLog(const char *fmt, ...) {
  char buf[200];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(buf, sizeof(buf), fmt, ap);
  va_end(ap);
  USBSerial.printf("net: %s\n", buf);
}

// --------------------------------------------------------------- identity ---

static void loadIdentity(Preferences &p) {
  memset(&identity, 0, sizeof(identity));
  if (p.getBytesLength("secret") == 16) {
    p.getBytes("secret", identity.secret, 16);
    USBSerial.println("identity: secret from NVS");
  } else {
    esp_fill_random(identity.secret, 16);
    p.putBytes("secret", identity.secret, 16);
    USBSerial.println("identity: new secret generated and stored");
  }
  for (int i = 0; i < 16; ++i) snprintf(identity.secretHex + 2 * i, 3, "%02x", identity.secret[i]);
  p.getString("pid", identity.potatoId, sizeof(identity.potatoId));
  p.getString("name", identity.name, sizeof(identity.name));
  p.getString("variety", identity.variety, sizeof(identity.variety));
  p.getString("claim", identity.claim, sizeof(identity.claim));
  identity.seed = p.getUInt("seed", 0);
  identity.registered = identity.potatoId[0] != 0;
  char storedServerUrl[sizeof(serverUrl)] = {0};
  p.getString("server", storedServerUrl, sizeof(storedServerUrl));
  if (selectServerUrl(storedServerUrl, SERVER_URL_DEFAULT, serverUrl, sizeof(serverUrl))) {
    p.putString("server", serverUrl);
    USBSerial.printf("net: migrated legacy LAN server to %s\n", serverUrl);
  }
#ifdef SERVER_URL
  strncpy(serverUrl, SERVER_URL, sizeof(serverUrl) - 1);   // dev override
#endif
  p.getString("tz", tzString, sizeof(tzString));
  if (!tzString[0]) strncpy(tzString, TZ_DEFAULT, sizeof(tzString) - 1);
}

// ------------------------------------------------------------------ https ---
//
// Identical in firmware/potato and firmware/paper. Edit both.
//
// What this closes. Before 0.3.0 the device already reached an `https://` Net
// and it was never safe: `HTTPClient::begin(String url)` fails to parse the
// URL as http, falls through to `begin(url, (const char *)NULL)`, and that
// installs a TLS transport whose verify() calls `setInsecure()`. The
// handshake succeeded with *any* certificate, so anything on the path could
// answer as the Net and hand a potato forged scenes, a forged Question or —
// worst — a forged firmware image. The bug was never a missing TLS stack; it
// was an unverified one.
//
// What replaces it: the Mozilla root store the Arduino core already ships
// inside its own prebuilt mbedtls archive (CONFIG_MBEDTLS_CERTIFICATE_BUNDLE
// _DEFAULT_FULL — 150 roots, 68,983 bytes). Naming the blob's linker symbols
// is what pulls it into the image. Nothing is pinned and nothing is generated
// or committed here, so the Net renews its certificate (Let's Encrypt, every
// 60 days) with no firmware update, and a refreshed root store arrives with
// the next core update. Regenerating a narrower bundle is possible with the
// core's tools/gen_crt_bundle.py, but costs a committed file that then has to
// be maintained by hand; it buys ~50 KB of flash we are not short of.
//
// `http://` is untouched and still plain. That is how a LAN Net is reached
// (the default http://potatoes.local:8080) and how the county runs today.
extern "C" {
extern const uint8_t x509CrtBundleStart[] asm("_binary_x509_crt_bundle_start");
extern const uint8_t x509CrtBundleEnd[] asm("_binary_x509_crt_bundle_end");
}

// One plain client and one secure client for the whole net task — register,
// heartbeat, choice, the OTA manifest and the OTA image all take turns on
// them, so only one handshake's RAM is ever live and an update never doubles
// it. Every request is a fresh connection: ~HTTPClient() stops the client it
// was given, which is also what stops a kept-alive socket to one host being
// reused for a request to another.
static NetworkClient netPlainClient;
static NetworkClientSecure netSecureClient;
static bool netSecureReady = false;
static bool netTlsHeapLogged = false;

static inline bool urlIsHttps(const char *url) {
  return strncasecmp(url, "https://", 8) == 0;
}

// A certificate is only valid between two dates, so it cannot be judged
// without a clock. NTP is asked in onConnected(); until it answers, https is
// refused rather than trusted.
static inline bool netClockSet() { return time(nullptr) > 1700000000; }

static void netSecureBegin() {
  const size_t n = (size_t)(x509CrtBundleEnd - x509CrtBundleStart);
  if (n < 1024) {
    netLog("TLS: this build carries no CA bundle — https will be refused");
    return;
  }
  netSecureClient.setCACertBundle(x509CrtBundleStart, n);
  netSecureClient.setHandshakeTimeout(15);   // seconds; the core's default is 120
  netSecureReady = true;
  USBSerial.printf("net: TLS ready — Mozilla root store %u bytes, certificates verified\n",
                   (unsigned)n);
}

// The transport this URL asks for, or nullptr when https cannot be trusted
// yet (*why says which). A refusal is never fatal and never destructive: the
// caller reports one failed request, and the potato keeps its secret, its
// name, its claim code and its last scene, and tries again.
static NetworkClient *netClientFor(const char *url, const char **why) {
  *why = nullptr;
  if (!urlIsHttps(url)) return &netPlainClient;
  if (!netSecureReady) { *why = "no CA bundle in this build"; return nullptr; }
  if (!netClockSet()) { *why = "waiting for the clock"; return nullptr; }
  return &netSecureClient;
}

// ------------------------------------------------------------------- http ---

// HTTPClient does not resolve .local names; mDNS does. Swap the host for its
// address when the server URL is a .local name.
static bool resolveUrl(char *out, size_t cap) {
  // https is left exactly as written: the name in the URL is the name the
  // certificate has to match, and mDNS would put a bare address there.
  if (urlIsHttps(serverUrl)) {
    strncpy(out, serverUrl, cap - 1);
    out[cap - 1] = 0;
    return true;
  }
  const char *h = strstr(serverUrl, "://");
  if (!h) { strncpy(out, serverUrl, cap - 1); return true; }
  h += 3;
  const char *end = h;
  while (*end && *end != ':' && *end != '/') ++end;
  char host[64];
  const size_t hl = (size_t)(end - h) < sizeof(host) - 1 ? (size_t)(end - h) : sizeof(host) - 1;
  memcpy(host, h, hl); host[hl] = 0;
  const size_t l = strlen(host);
  if (l < 7 || strcmp(host + l - 6, ".local") != 0) {
    strncpy(out, serverUrl, cap - 1);
    return true;
  }
  host[l - 6] = 0;
  IPAddress ip = MDNS.queryHost(host, 3000);
  if (ip == IPAddress((uint32_t)0)) {
    netLog("mDNS: %s.local not found", host);
    return false;
  }
  snprintf(out, cap, "%.*s%s%s", (int)(h - serverUrl), serverUrl, ip.toString().c_str(), end);
  return true;
}

// -100 unresolved host, -101 bad URL, -102 https refused (see netClientFor).
// All three are < 0, which every caller already treats as "no answer": the
// request fails, the events stay queued, nothing in NVS is touched.
static int httpPostJson(const char *path, const String &body, String &resp) {
  char base[128];
  if (!resolveUrl(base, sizeof(base))) return -100;
  String url = String(base) + path;
  const char *why = nullptr;
  NetworkClient *client = netClientFor(url.c_str(), &why);
  if (!client) { netLog("%s: https refused — %s", path, why); return -102; }
  const bool secure = (client == &netSecureClient);
  const uint32_t heapBefore = ESP.getFreeHeap();
  HTTPClient http;
  http.setTimeout(HTTP_TIMEOUT_MS);
  http.setConnectTimeout(HTTP_TIMEOUT_MS);
  if (!http.begin(*client, url)) return -101;
  http.addHeader("Content-Type", "application/json");
  const int code = http.POST(body);
  // Once, on the first verified connection: what one live TLS session
  // actually costs on this board. Sampled before getString() allocates the
  // body, so it is the session and nothing else.
  if (secure && code > 0 && !netTlsHeapLogged) {
    netTlsHeapLogged = true;
    const uint32_t heapAfter = ESP.getFreeHeap();
    USBSerial.printf("net: TLS live — heap %lu -> %lu (%ld bytes for one verified connection)\n",
                     (unsigned long)heapBefore, (unsigned long)heapAfter,
                     (long)heapBefore - (long)heapAfter);
  }
  if (code < 0) {
    if (secure) {
      char tlsError[128] = {0};
      const int tlsCode = netSecureClient.lastError(tlsError, sizeof(tlsError));
      netLog("%s: transport %d (%s), TLS %d (%s)", path, code,
             HTTPClient::errorToString(code).c_str(), tlsCode, tlsError);
    } else {
      netLog("%s: transport %d (%s)", path, code, HTTPClient::errorToString(code).c_str());
    }
  }
  if (code > 0) resp = http.getString();
  http.end();
  return code;
}

#include "ota.h"   // needs resolveUrl(), netLog(), BOARD_NAME, FW_VERSION above

// --------------------------------------------------------------- protocol ---

static bool doRegister() {
  char body[256];
  String resp;
  buildRegisterJson(identity.secretHex, BOARD_NAME, FW_VERSION, body, sizeof(body));
  const int code = httpPostJson("/v0/register", String(body), resp);
  if (code != 200) {
    netLog("register: http %d", code);
    { NetLock l; ++net.failures; net.lastHttpOk = false; }
    return false;
  }
  { NetLock l; net.lastHttpOk = true; }
  JsonDocument r;
  if (deserializeJson(r, resp) != DeserializationError::Ok) {
    netLog("register: bad json");
    return false;
  }
  strncpy(identity.potatoId, r["potato_id"] | "", sizeof(identity.potatoId) - 1);
  strncpy(identity.name, r["name"] | "", sizeof(identity.name) - 1);
  strncpy(identity.variety, r["variety"] | "", sizeof(identity.variety) - 1);
  strncpy(identity.claim, r["claim_code"] | "", sizeof(identity.claim) - 1);
  identity.seed = r["seed"] | 0u;
  identity.registered = identity.potatoId[0] != 0;
  netPrefs.putString("pid", identity.potatoId);
  netPrefs.putString("name", identity.name);
  netPrefs.putString("variety", identity.variety);
  netPrefs.putString("claim", identity.claim);
  if (identity.seed) netPrefs.putUInt("seed", identity.seed);
  netLog("registered as %s #%s, %s, claim %s, seed %lu", identity.name, identity.potatoId,
         identity.variety, identity.claim, (unsigned long)identity.seed);
  {
    NetLock l;
    net.registered = identity.registered;
    net.claimFresh = true;
  }
  return identity.registered;
}

static void storeScene(const String &json) {
  if ((int)json.length() >= SCENE_JSON_CAP) { netLog("scene too long (%u)", json.length()); return; }
  if ((int)json.length() < SCENE_NVS_CAP) netPrefs.putString("scene", json);
  else netLog("scene %u bytes: shown, not cached (NVS cap)", json.length());
  NetLock l;
  strncpy(net.sceneJson, json.c_str(), SCENE_JSON_CAP - 1);
  net.sceneJson[SCENE_JSON_CAP - 1] = 0;
  net.sceneFresh = true;
}

static bool doHeartbeat() {
  HeartbeatSnapshot snap;
  int nEvents = 0;
  Event evs[EVENT_CAP];
  int revSeen;
  {
    NetLock l;
    snap = net.snap;
    revSeen = net.revSeen;
    nEvents = net.events->count;
    for (int i = 0; i < nEvents; ++i) evs[i] = net.events->at(i);
  }
  const time_t nowEpoch = time(nullptr);
  static char body[2048];
  buildHeartbeatJson(identity.secretHex, FW_VERSION, revSeen, snap, evs, nEvents, (long)nowEpoch, millis(),
                     body, sizeof(body));
  String resp;
  const int code = httpPostJson("/v0/heartbeat", String(body), resp);
  if (code == 401 || code == 403 || code == 404) {
    // A server that does not know this secret: a new server, or a wiped
    // database. Register again; the secret and the events are kept.
    netLog("heartbeat: http %d — unknown here, registering again", code);
    identity.registered = false;
    netPrefs.remove("pid");
    NetLock l;
    net.registered = false;
    net.lastHttpOk = true;   // the server answered; it just does not know us
    ++net.failures;
    return false;
  }
  if (code != 200) {
    netLog("heartbeat: http %d (%d events held)", code, nEvents);
    NetLock l;
    ++net.failures;
    net.lastHttpOk = code > 0;
    return false;
  }
  {
    NetLock l;
    net.events->drop(nEvents);
    ++net.heartbeats;
    net.lastHttpOk = true;
  }
  otaConfirmValid();   // a new image has proven itself: cancel the rollback
  if (nowEpoch > 1700000000) netPrefs.putULong("last_epoch", (unsigned long)nowEpoch);
  netLog("heartbeat ok: %d events drained, %u bytes back", nEvents, resp.length());
  storeScene(resp);
  return true;
}

static bool doChoice(int rev, const char *id) {
  char body[160];
  String resp;
  buildChoiceJson(identity.secretHex, rev, id, body, sizeof(body));
  const int code = httpPostJson("/v0/choice", String(body), resp);
  if (code != 200 && code != 409) {
    netLog("choice %s: http %d", id, code);
    NetLock l;
    ++net.failures;
    net.lastHttpOk = code > 0;
    return false;
  }
  { NetLock l; net.lastHttpOk = true; }
  netLog("choice %s: http %d, %u bytes back", id, code, resp.length());
  storeScene(resp);
  return true;
}

// ------------------------------------------------------------------- wifi ---

static void onPortalStart(WiFiManager *m) {
  (void)m;
  char line[MAX_LINE];
  snprintf(line, sizeof(line), "Join Wi-Fi %s and give me the county's network.", apName);
  netSetStatusLine(line);
  netSetStatus("portal");
  netLog("captive portal up: AP %s, http://192.168.4.1", apName);
}

static bool portalSubmitted = false;

static void onPreSave() {
  portalSubmitted = true;
  { NetLock l; net.connecting = true; }
  netSetStatus("connecting");
  netLog("portal: credentials submitted; connecting (panel refreshes held)");
}

// Fires after the connect attempt, success or (with breakAfterConfig) failure.
static void onWifiSaved() {
  netLog("portal: save callback, result %u (%s)", wm.getLastConxResult(), wm.getWLStatusString(wm.getLastConxResult()).c_str());
}

static void onParamsSaved() {
  strncpy(serverUrl, paramServer->getValue(), sizeof(serverUrl) - 1);
  strncpy(tzString, paramTz->getValue(), sizeof(tzString) - 1);
  netPrefs.putString("server", serverUrl);
  netPrefs.putString("tz", tzString);
  netLog("saved server %s tz %s", serverUrl, tzString);
}

static bool portalRunning = false;

// Try to join: secrets.h (only if filled in), then the saved credentials,
// then open the portal and return false with it running. Non-blocking: the
// task loop drives the portal with wm.process() and real delays, so IDLE0
// gets the CPU (WiFiManager's blocking loop only yield()s, which never runs
// the idle task; the task watchdog then resets the chip every ~40 s, which
// reprinted the page and lost every portal save mid-connect).
static bool connectWifi() {
  netSetStatus("connecting");
  { NetLock l; net.connecting = true; }
  WiFi.persistent(true);
#if defined(WIFI_SSID) && defined(WIFI_PASS)
  if (WIFI_SSID[0]) {
    netLog("trying the secrets.h network");
    WiFi.begin(WIFI_SSID, WIFI_PASS);
    for (int i = 0; i < 100 && WiFi.status() != WL_CONNECTED; ++i) vTaskDelay(pdMS_TO_TICKS(200));
    if (WiFi.status() == WL_CONNECTED) { NetLock l; net.connecting = false; return true; }
    netLog("secrets.h network did not connect (status %d); saved credentials / portal next", (int)WiFi.status());
  }
#endif
  portalSubmitted = false;
  const bool ok = wm.autoConnect(apName);        // saved credentials; else the portal starts and this returns
  if (ok) { NetLock l; net.connecting = false; return true; }
  portalRunning = wm.getConfigPortalActive();
  { NetLock l; net.connecting = false; }
  if (!portalRunning) netLog("wifi: not connected and no portal (last result %u, %s)", wm.getLastConxResult(), wm.getWLStatusString().c_str());
  return false;
}

// One step of the open portal. Returns true once a save has connected.
static bool portalStep() {
  const bool connected = wm.process();
  if (connected) {
    portalRunning = false;
    { NetLock l; net.connecting = false; }
    netLog("portal: connected with the submitted credentials (stored in NVS by the driver)");
    return true;
  }
  if (!wm.getConfigPortalActive()) {
    portalRunning = false;
    const uint8_t res = wm.getLastConxResult();
    if (portalSubmitted) {
      // WL_CONNECT_FAILED = wrong password, WL_NO_SSID_AVAIL = not found, else timed out.
      const String saved = wm.getWiFiSSID(true);
      netLog("portal: save did not connect — result %u (%s); the driver stored \"%s\" anyway; reopening", res,
             wm.getWLStatusString(res).c_str(), saved.c_str());
      NetLock l;
      strncpy(net.joinFailSsid, saved.c_str(), sizeof(net.joinFailSsid) - 1);
      net.joinFailCode = res;
      net.joinFailFresh = true;
      net.connecting = false;
    } else {
      netLog("portal: closed (timeout after %lus with no phone attached); reopening", (unsigned long)PORTAL_TIMEOUT_S);
    }
  }
  return false;
}

static void onConnected() {
  netSetStatus("online");
  netLog("connected: ip %s rssi %d", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  configTzTime(tzString, "pool.ntp.org", "time.nist.gov", "time.google.com");
  if (!MDNS.begin(apName)) netLog("mDNS start failed");
  {
    NetLock l;
    net.online = true;
    net.statusLine[0] = 0;
    net.statusLineFresh = true;
    if (wasOnline && wifiLostAtMs) {
      const uint32_t dur = (millis() - wifiLostAtMs) / 1000;
      if (dur >= 60) { net.wifiBack = true; net.wifiBackDurS = dur; }
    }
  }
  wasOnline = true;
  wifiLostAtMs = 0;
  lastHeartbeatMs = millis() - HEARTBEAT_MS;   // heartbeat now, not in 120s
}

static void netTask(void *arg) {
  (void)arg;
  bool dormantChecked = false;
  bool waitingForClock = false;
  for (;;) {
    if (WiFi.status() != WL_CONNECTED) {
      if (wasOnline && !wifiLostAtMs) {
        wifiLostAtMs = millis();
        netSetStatus("lost");
        NetLock l;
        net.online = false;
        net.wifiLost = true;
      }
      if (portalRunning) {
        if (!portalStep()) { vTaskDelay(pdMS_TO_TICKS(portalRunning ? 10 : 1500)); continue; }
      } else if (!connectWifi()) {
        vTaskDelay(pdMS_TO_TICKS(portalRunning ? 10 : 5000));
        continue;
      }
      onConnected();
    }

    const time_t nowEpoch = time(nullptr);
    const bool synced = nowEpoch > 1700000000;
    if (synced && !net.timeSynced) {
      NetLock l;
      net.timeSynced = true;
    }
    if (synced && !dormantChecked) {
      dormantChecked = true;
      const unsigned long last = netPrefs.getULong("last_epoch", 0);
      const esp_reset_reason_t why = esp_reset_reason();
      if (last && (why == ESP_RST_POWERON || why == ESP_RST_BROWNOUT) && nowEpoch > (time_t)last) {
        NetLock l;
        net.dormantFresh = true;
        net.dormantDurS = (uint32_t)(nowEpoch - (time_t)last);
      }
    }

    // On an https Net, nothing at all goes out before NTP answers: a
    // certificate cannot be judged without a clock, and a first-boot
    // registration that fails the handshake looks like a broken potato.
    // Typically a second or two after the join; no refresh is spent on it.
    if (urlIsHttps(serverUrl) && !synced) {
      if (!waitingForClock) {
        waitingForClock = true;
        netSetStatus("clock");
        netLog("https Net and no clock yet — waiting for NTP before speaking");
        if (!identity.registered) netSetStatusLine("Waiting for the clock.");
      }
      vTaskDelay(pdMS_TO_TICKS(500));
      continue;
    }
    if (waitingForClock) {
      waitingForClock = false;
      netSetStatus("online");
      if (!identity.registered) netSetStatusLine("");
      netLog("clock set; the Net can be verified");
    }

    if (!identity.registered) {
      if (!doRegister()) { vTaskDelay(pdMS_TO_TICKS(15000)); continue; }
    }

    bool want = false, choice = false;
    int choiceRev = 0;
    char choiceId[24];
    {
      NetLock l;
      want = net.wantHeartbeat;
      net.wantHeartbeat = false;
      choice = net.choicePending;
      net.choicePending = false;
      choiceRev = net.choiceRev;
      strncpy(choiceId, net.choiceId, sizeof(choiceId));
    }
    if (choice) doChoice(choiceRev, choiceId);
    if (want || millis() - lastHeartbeatMs >= HEARTBEAT_MS) {
      lastHeartbeatMs = millis();
      doHeartbeat();
    }
    otaTick(true);
    vTaskDelay(pdMS_TO_TICKS(250));
  }
}

// Call from setup() after Preferences are open. Starts the task.
static void netBegin(Preferences &loopPrefs, EventQueue *events) {
  netMtx = xSemaphoreCreateMutex();
  memset(&net, 0, sizeof(net));
  net.events = events;
  net.snap.sound = "quiet";
  strncpy(net.snap.orientation, "up", sizeof(net.snap.orientation));
  strncpy(net.status, "starting", sizeof(net.status));
  netPrefs.begin("potato", false);
  loadIdentity(loopPrefs);
  netSecureBegin();
  otaBegin();
  net.registered = identity.registered;

  // The factory MAC, readable before the Wi-Fi driver is up. Last two bytes
  // name the potato's own network: POTATO-B458.
  uint8_t mac[6];
  esp_read_mac(mac, ESP_MAC_WIFI_STA);
  snprintf(apName, sizeof(apName), "POTATO-%02X%02X", mac[4], mac[5]);
  WiFi.mode(WIFI_STA);

  // Cached scene from the last time the Net answered.
  String cached = loopPrefs.getString("scene", "");
  if (cached.length()) {
    strncpy(net.sceneJson, cached.c_str(), SCENE_JSON_CAP - 1);
    net.sceneFresh = true;
  }

  wm.setDebugOutput(false);
  wm.setConfigPortalTimeout(PORTAL_TIMEOUT_S);
  wm.setConnectTimeout(20);
  wm.setConfigPortalBlocking(false);  // the task loop drives it; see connectWifi()
  wm.setAPClientCheck(true);          // no portal timeout while a phone is on the AP
  wm.setBreakAfterConfig(true);       // a failed save closes the portal at once and says why
  wm.setAPCallback(onPortalStart);
  wm.setPreSaveConfigCallback(onPreSave);
  wm.setSaveConfigCallback(onWifiSaved);
  wm.setSaveParamsCallback(onParamsSaved);
  USBSerial.printf("net: wifi credentials in NVS: %s\n",
                   wm.getWiFiIsSaved() ? (String("\"") + wm.getWiFiSSID(true) + "\"").c_str() : "none");
  paramServer = new WiFiManagerParameter("server", "Server URL", serverUrl, sizeof(serverUrl) - 1);
  paramTz = new WiFiManagerParameter("tz", "POSIX TZ", tzString, sizeof(tzString) - 1);
  wm.addParameter(paramServer);
  wm.addParameter(paramTz);

  USBSerial.printf("net: %s, server %s, tz %s, %s, cached scene %s\n",
                   apName, serverUrl, tzString,
                   identity.registered ? "registered" : "not registered",
                   cached.length() ? "yes" : "no");
  if (identity.registered) {
    USBSerial.printf("net: I am %s #%s, %s, claim %s\n", identity.name, identity.potatoId,
                     identity.variety, identity.claim);
  }
  xTaskCreatePinnedToCore(netTask, "net", 12288, nullptr, 1, nullptr, 0);
}

// Loop side: update what the next heartbeat will carry. Cheap; call often.
static void netUpdateSnapshot(int pct, bool charging, bool vbus, const char *orientation,
                              uint32_t sinceHandledS, bool hasTemp, float tempC,
                              bool hasOffset, int utcOffsetMin) {
  NetLock l;
  net.snap.pct = pct;
  net.snap.charging = charging;
  net.snap.vbus = vbus;
  strncpy(net.snap.orientation, orientation, sizeof(net.snap.orientation) - 1);
  net.snap.sinceHandledS = sinceHandledS;
  net.snap.hasTemp = hasTemp;
  net.snap.tempC = tempC;
  net.snap.hasOffset = hasOffset;
  net.snap.utcOffsetMin = utcOffsetMin;
}

static void netRequestHeartbeat() { NetLock l; net.wantHeartbeat = true; }

static void netSendChoice(int rev, const char *id) {
  NetLock l;
  net.choicePending = true;
  net.choiceRev = rev;
  strncpy(net.choiceId, id, sizeof(net.choiceId) - 1);
  net.choiceId[sizeof(net.choiceId) - 1] = 0;
}

// Forget the registration (not the secret): register again next cycle.
static void netReregister() {
  identity.registered = false;
  netPrefs.remove("pid");
  NetLock l;
  net.registered = false;
  netLog("registration cleared; will register again");
}

// Wipe Wi-Fi credentials (not the identity). Dev/owner command.
static void netForgetWifi() {
  wm.resetSettings();
  netLog("wifi credentials erased; restart to use the portal");
}
