#pragma once

#include <HTTPClient.h>
#include <Update.h>
#include <ArduinoJson.h>
#include "esp_ota_ops.h"
#include "esp_partition.h"
#include "mbedtls/sha256.h"

// Over-the-air updates, protocol v0 `GET /v0/firmware` (docs/PROTOCOL.md,
// "Notes from implementation"). Runs inside the net task: once a day, and on
// request, ask the server for a manifest; if it names a newer version,
// stream the image into the inactive OTA slot, verify its SHA-256, set it as
// the boot partition, and leave `ota.ready` for the loop to pick a quiet
// moment to reboot. On the next boot the image is pending verification
// until the first good heartbeat marks it valid; otherwise the bootloader
// rolls back to the previous slot.
//
// Identical copies live in firmware/potato and firmware/paper. Edit both.
// Needs, from net.h before this include: resolveUrl(), netLog(), BOARD_NAME,
// FW_VERSION, USBSerial.

static const uint32_t OTA_CHECK_MS = 24UL * 3600UL * 1000UL;
static const uint32_t OTA_FIRST_CHECK_MS = 90000;   // after boot, once online

struct OtaState {
  bool checkRequested;
  bool everChecked;
  uint32_t lastCheckMs;
  bool busy;
  bool ready;               // verified image in the other slot; reboot when quiet
  char version[16];
  char notes[80];
  char lastResult[72];
};
static OtaState ota;
static bool otaImageValidated = false;

static inline bool versionNewer(const char *cand, const char *cur) {
  int a[3] = {0, 0, 0}, b[3] = {0, 0, 0};
  sscanf(cand, "%d.%d.%d", &a[0], &a[1], &a[2]);
  sscanf(cur, "%d.%d.%d", &b[0], &b[1], &b[2]);
  for (int i = 0; i < 3; ++i) {
    if (a[i] != b[i]) return a[i] > b[i];
  }
  return false;
}

static void otaSetResult(const char *s) {
  strncpy(ota.lastResult, s, sizeof(ota.lastResult) - 1);
  ota.lastResult[sizeof(ota.lastResult) - 1] = 0;
}

// Boot: say where we are running from and whether this image still has to
// prove itself.
static void otaBegin() {
  const esp_partition_t *run = esp_ota_get_running_partition();
  const esp_partition_t *next = esp_ota_get_next_update_partition(nullptr);
  esp_ota_img_states_t st;
  const bool haveState = run && esp_ota_get_state_partition(run, &st) == ESP_OK;
  const char *stateName = !haveState ? "unknown"
                          : st == ESP_OTA_IMG_PENDING_VERIFY ? "pending-verify"
                          : st == ESP_OTA_IMG_VALID ? "valid"
                          : st == ESP_OTA_IMG_NEW ? "new"
                          : st == ESP_OTA_IMG_UNDEFINED ? "undefined" : "other";
  USBSerial.printf("ota: fw %s running from %s @0x%06lx (%lu KB slot), next slot %s; image state %s\n",
                   FW_VERSION, run ? run->label : "?", run ? (unsigned long)run->address : 0UL,
                   run ? (unsigned long)(run->size / 1024) : 0UL, next ? next->label : "none", stateName);
  if (haveState && st == ESP_OTA_IMG_PENDING_VERIFY) {
    USBSerial.println("ota: this image is pending verification — confirmed after the first good heartbeat, else the bootloader rolls back");
  } else {
    otaImageValidated = true;
  }
  memset(&ota, 0, sizeof(ota));
  otaSetResult("not checked yet");
}

// After the first successful heartbeat on a new image.
static void otaConfirmValid() {
  if (otaImageValidated) return;
  otaImageValidated = true;
  const esp_err_t e = esp_ota_mark_app_valid_cancel_rollback();
  USBSerial.printf("ota: image marked valid, rollback cancelled (%s)\n", esp_err_to_name(e));
}

static void otaRequestCheck() { ota.checkRequested = true; }

static bool otaFetchManifest(char *version, size_t vcap, char *url, size_t ucap,
                             char *sha, size_t scap, size_t *size, char *notes, size_t ncap) {
  char base[128];
  if (!resolveUrl(base, sizeof(base))) { otaSetResult("server unresolved"); return false; }
  String u = String(base) + "/v0/firmware?board=" + BOARD_NAME + "&fw=" + FW_VERSION;
  HTTPClient http;
  http.setTimeout(8000);
  http.setConnectTimeout(8000);
  if (!http.begin(u)) { otaSetResult("bad url"); return false; }
  const int code = http.GET();
  if (code == 204 || code == 304) { http.end(); otaSetResult("up to date"); return false; }
  if (code != 200) {
    http.end();
    char b[64];
    snprintf(b, sizeof(b), "manifest http %d", code);
    otaSetResult(b);
    return false;
  }
  String body = http.getString();
  http.end();
  JsonDocument doc;
  if (deserializeJson(doc, body) != DeserializationError::Ok) { otaSetResult("manifest bad json"); return false; }
  const char *v = doc["version"] | "";
  if (!v[0] || !versionNewer(v, FW_VERSION)) { otaSetResult("up to date (manifest not newer)"); return false; }
  strncpy(version, v, vcap - 1); version[vcap - 1] = 0;
  const char *ru = doc["url"] | "";
  if (ru[0] == '/') snprintf(url, ucap, "%s%s", base, ru);   // relative to the server
  else { strncpy(url, ru, ucap - 1); url[ucap - 1] = 0; }
  strncpy(sha, doc["sha256"] | "", scap - 1); sha[scap - 1] = 0;
  *size = doc["size"] | 0u;
  strncpy(notes, doc["notes"] | "", ncap - 1); notes[ncap - 1] = 0;
  if (!url[0] || strlen(sha) != 64 || !*size) { otaSetResult("manifest incomplete"); return false; }
  return true;
}

static bool otaDownload(const char *url, const char *shaHex, size_t size) {
  const esp_partition_t *next = esp_ota_get_next_update_partition(nullptr);
  if (!next) { otaSetResult("no OTA slot"); return false; }
  if (size > next->size) { otaSetResult("image larger than slot"); return false; }
  HTTPClient http;
  http.setTimeout(15000);
  http.setConnectTimeout(8000);
  if (!http.begin(url)) { otaSetResult("bad image url"); return false; }
  const int code = http.GET();
  if (code != 200) { http.end(); char b[48]; snprintf(b, sizeof(b), "image http %d", code); otaSetResult(b); return false; }
  const int len = http.getSize();
  if (len > 0 && (size_t)len != size) { http.end(); otaSetResult("image size differs from manifest"); return false; }
  if (!Update.begin(size, U_FLASH)) {
    http.end();
    char b[72]; snprintf(b, sizeof(b), "Update.begin: %s", Update.errorString()); otaSetResult(b);
    return false;
  }
  mbedtls_sha256_context sha;
  mbedtls_sha256_init(&sha);
  mbedtls_sha256_starts(&sha, 0);
  static uint8_t buf[4096];
  WiFiClient *stream = http.getStreamPtr();
  size_t got = 0;
  int lastPct = -1;
  uint32_t lastDataMs = millis();
  bool ok = true;
  while (got < size) {
    const size_t avail = stream->available();
    if (!avail) {
      if (!http.connected() || millis() - lastDataMs > 20000) { otaSetResult("image stream stalled"); ok = false; break; }
      delay(10);
      continue;
    }
    const size_t n = stream->readBytes(buf, avail < sizeof(buf) ? avail : sizeof(buf));
    if (!n) continue;
    lastDataMs = millis();
    if (Update.write(buf, n) != n) {
      char b[72]; snprintf(b, sizeof(b), "Update.write: %s", Update.errorString()); otaSetResult(b);
      ok = false; break;
    }
    mbedtls_sha256_update(&sha, buf, n);
    got += n;
    const int pct = (int)((uint64_t)got * 100 / size);
    if (pct / 10 != lastPct / 10) { lastPct = pct; USBSerial.printf("ota: %d%% (%u/%u)\n", pct, (unsigned)got, (unsigned)size); }
  }
  http.end();
  unsigned char digest[32];
  mbedtls_sha256_finish(&sha, digest);
  mbedtls_sha256_free(&sha);
  if (!ok) { Update.abort(); return false; }
  char hex[65];
  for (int i = 0; i < 32; ++i) snprintf(hex + 2 * i, 3, "%02x", digest[i]);
  if (strncasecmp(hex, shaHex, 64) != 0) { Update.abort(); otaSetResult("sha256 mismatch — image discarded"); return false; }
  if (!Update.end(true)) {
    char b[72]; snprintf(b, sizeof(b), "Update.end: %s", Update.errorString()); otaSetResult(b);
    return false;
  }
  return true;   // boot partition now points at the new slot
}

// Call from the net task loop, often; it rate-limits itself.
static void otaTick(bool online) {
  if (!online || ota.busy) return;
  if (ota.ready) {
    // By design: a verified image already waits in the other slot and the
    // boot partition points at it. A newer manifest is picked up by the
    // next daily check after that reboot. Say so rather than go quiet.
    if (ota.checkRequested) {
      ota.checkRequested = false;
      USBSerial.printf("ota: update %s pending reboot; check skipped\n", ota.version);
    }
    return;
  }
  const uint32_t now = millis();
  if (!ota.checkRequested) {
    if (!ota.everChecked && now < OTA_FIRST_CHECK_MS) return;
    if (ota.everChecked && now - ota.lastCheckMs < OTA_CHECK_MS) return;
  }
  ota.checkRequested = false;
  ota.everChecked = true;
  ota.lastCheckMs = now;
  ota.busy = true;
  char version[16], url[160], sha[65], notes[80];
  size_t size = 0;
  USBSerial.printf("ota: check (board %s, fw %s)\n", BOARD_NAME, FW_VERSION);
  if (otaFetchManifest(version, sizeof(version), url, sizeof(url), sha, sizeof(sha), &size, notes, sizeof(notes))) {
    USBSerial.printf("ota: %s available (%u bytes) — %s\n", version, (unsigned)size, notes[0] ? notes : "no notes");
    if (otaDownload(url, sha, size)) {
      strncpy(ota.version, version, sizeof(ota.version) - 1);
      strncpy(ota.notes, notes, sizeof(ota.notes) - 1);
      otaSetResult("downloaded and verified; reboot pending");
      ota.ready = true;
      USBSerial.printf("ota: %s verified in %s; rebooting at a quiet moment\n", version,
                       esp_ota_get_next_update_partition(nullptr) ? esp_ota_get_next_update_partition(nullptr)->label : "?");
    } else {
      USBSerial.printf("ota: failed — %s\n", ota.lastResult);
    }
  } else {
    USBSerial.printf("ota: %s\n", ota.lastResult);
  }
  ota.busy = false;
}
