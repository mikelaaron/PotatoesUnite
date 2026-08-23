#pragma once

#include <stdint.h>
#include <string.h>
#include <stdlib.h>
#include <ArduinoJson.h>
#include "events.h"
#include "potato_shape.h"

// Protocol v0 wire format (docs/PROTOCOL.md), kept free of Arduino so the
// same code runs in firmware/tools/protocol_test.cpp on the host. Builds the
// three request bodies and parses a Scene. Nothing here knows about Wi-Fi,
// the screen, or the secret's origin.

static const int MAX_LINE = 128;
static const int MAX_CHOICES = 3;

struct Choice {
  char id[24];
  char label[17];   // ≤ 16 chars per the protocol
};

struct HeartbeatSnapshot {
  int pct;
  bool charging, vbus;
  char orientation[10];
  uint32_t sinceHandledS;
  const char *sound;     // "quiet" | "normal" | "loud"
};

struct SceneData {
  int rev;
  Expression expression;
  char expressionName[12];
  char line[MAX_LINE];
  Choice choices[MAX_CHOICES];
  uint8_t nChoices;
  char cue[16];
  int fileUnread;
  uint32_t expiresAt;
  bool hasRequest;
  char requestId[12];
  char requestText[MAX_LINE];
  char requestCheck[24];
  float requestForS;
  uint32_t requestExpiresAt;
};

static inline void copyStr(char *dst, size_t cap, const char *src) {
  strncpy(dst, src ? src : "", cap - 1);
  dst[cap - 1] = 0;
}

static inline Expression expressionFrom(const char *s) {
  if (!strcmp(s, "waiting")) return EXPR_WAITING;
  if (!strcmp(s, "aggrieved")) return EXPR_AGGRIEVED;
  if (!strcmp(s, "pleased")) return EXPR_PLEASED;
  if (!strcmp(s, "asleep")) return EXPR_ASLEEP;
  if (!strcmp(s, "dormant")) return EXPR_DORMANT;
  if (!strcmp(s, "sprouted")) return EXPR_SPROUTED;
  return EXPR_NEUTRAL;
}

// A Scene from heartbeat or choice. Missing fields take neutral defaults so a
// minimal {"rev":1,"line":"..."} is a valid scene. Returns false on bad JSON.
static bool parseScene(const char *json, SceneData &out) {
  JsonDocument doc;
  if (deserializeJson(doc, json) != DeserializationError::Ok) return false;
  memset(&out, 0, sizeof(out));
  out.rev = doc["rev"] | 0;
  copyStr(out.expressionName, sizeof(out.expressionName), doc["expression"] | "neutral");
  out.expression = expressionFrom(out.expressionName);
  copyStr(out.line, sizeof(out.line), doc["line"] | "");
  copyStr(out.cue, sizeof(out.cue), doc["cue"] | "none");
  out.fileUnread = doc["file_unread"] | 0;
  out.expiresAt = doc["expires_at"] | 0u;
  for (JsonObject c : doc["choices"].as<JsonArray>()) {
    if (out.nChoices >= MAX_CHOICES) break;
    Choice &ch = out.choices[out.nChoices++];
    copyStr(ch.id, sizeof(ch.id), c["id"] | "");
    copyStr(ch.label, sizeof(ch.label), c["label"] | "");
  }
  JsonObject rq = doc["request"].as<JsonObject>();
  if (!rq.isNull()) {
    out.hasRequest = true;
    copyStr(out.requestId, sizeof(out.requestId), rq["id"] | "");
    copyStr(out.requestText, sizeof(out.requestText), rq["text"] | "");
    copyStr(out.requestCheck, sizeof(out.requestCheck), rq["check"] | "");
    out.requestForS = (float)(rq["for_s"] | 0);
    out.requestExpiresAt = rq["expires_at"] | 0u;
    // still:<s> and held:<s> carry their duration in the check itself.
    const char *colon = strchr(out.requestCheck, ':');
    if (colon && (!strncmp(out.requestCheck, "still:", 6) || !strncmp(out.requestCheck, "held:", 5))) {
      out.requestForS = (float)atoi(colon + 1);
    }
  }
  return true;
}

static size_t buildRegisterJson(const char *secretHex, const char *board, const char *fw,
                                char *out, size_t cap) {
  JsonDocument doc;
  doc["secret"] = secretHex;
  doc["board"] = board;
  doc["fw"] = fw;
  return serializeJson(doc, out, cap);
}

// Event times are kept as millis on the device and converted here. t = 0
// means the device had no clock yet; the server should use arrival time.
static size_t buildHeartbeatJson(const char *secretHex, const char *fw, int revSeen,
                                 const HeartbeatSnapshot &snap, const Event *evs, int nEvents,
                                 long nowEpoch, uint32_t nowMs, char *out, size_t cap) {
  JsonDocument doc;
  doc["secret"] = secretHex;
  doc["fw"] = fw;   // every heartbeat, so the server sees which version actually stuck
  doc["rev_seen"] = revSeen;
  JsonObject b = doc["battery"].to<JsonObject>();
  // The field is always present; pct is null when the battery is unknown
  // (no PMU). The server stores null and makes no judgement on it.
  if (snap.pct < 0) b["pct"] = nullptr; else b["pct"] = snap.pct;
  b["charging"] = snap.charging;
  b["vbus"] = snap.vbus;
  doc["orientation"] = snap.orientation;
  doc["since_handled_s"] = snap.sinceHandledS;
  doc["sound"] = snap.sound;
  JsonArray arr = doc["events"].to<JsonArray>();
  const bool synced = nowEpoch > 1700000000L;
  for (int i = 0; i < nEvents; ++i) {
    JsonObject e = arr.add<JsonObject>();
    e["t"] = synced ? (long)(nowEpoch - (long)((nowMs - evs[i].ms) / 1000)) : 0L;
    e["type"] = EVENT_NAMES[evs[i].type];
    const char *k = eventValueKey(evs[i].type);
    if (k && evs[i].sval[0]) e[k] = evs[i].sval;
    else if (k) e[k] = evs[i].value;
  }
  return serializeJson(doc, out, cap);
}

static size_t buildChoiceJson(const char *secretHex, int rev, const char *id, char *out, size_t cap) {
  JsonDocument doc;
  doc["secret"] = secretHex;
  doc["scene_rev"] = rev;
  doc["choice_id"] = id;
  return serializeJson(doc, out, cap);
}
