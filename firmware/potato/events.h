#pragma once

#include <stdint.h>
#include <string.h>

// Things that happened to the potato, queued for the next heartbeat. The
// device is the judge of what happened; the server only counts. Names match
// docs/PROTOCOL.md exactly.

enum EventType : uint8_t {
  EV_PICKUP = 0,
  EV_PUTDOWN,
  EV_FACEDOWN_START,
  EV_FACEDOWN_END,
  EV_INVERTED_START,
  EV_INVERTED_END,
  EV_SHAKE,
  EV_DROP,
  EV_TAP,
  EV_TRANSIT_START,
  EV_TRANSIT_END,
  EV_CHARGE_START,
  EV_CHARGE_END,
  EV_BATTERY_LOW,
  EV_DORMANT_RESUME,
  EV_WIFI_RESTORE,
  EV_REQUEST_DONE,
  EV_REQUEST_EXPIRED,
  EV_COUNT
};

static const char *const EVENT_NAMES[EV_COUNT] = {
    "pickup", "putdown", "facedown_start", "facedown_end",
    "inverted_start", "inverted_end", "shake", "drop", "tap",
    "transit_start", "transit_end", "charge_start", "charge_end",
    "battery_low", "dormant_resume", "wifi_restore",
    "request_done", "request_expired",
};

// Which JSON key the value travels under, if any.
static inline const char *eventValueKey(EventType t) {
  switch (t) {
    case EV_FACEDOWN_END: case EV_INVERTED_END: case EV_TRANSIT_END:
    case EV_DORMANT_RESUME: case EV_WIFI_RESTORE:
      return "dur_s";
    case EV_BATTERY_LOW:
      return "pct";
    case EV_REQUEST_DONE: case EV_REQUEST_EXPIRED:
      return "request_id";
    default:
      return nullptr;
  }
}

struct Event {
  uint32_t ms;       // millis() when it happened; converted to epoch at send
  EventType type;
  int32_t value;     // dur_s or pct
  char sval[12];     // request_id, when the key is a string
};

static const int EVENT_CAP = 32;

struct EventQueue {
  Event items[EVENT_CAP];
  uint8_t head = 0;
  uint8_t count = 0;
  uint32_t dropped = 0;

  void push(uint32_t ms, EventType t, int32_t v, const char *s = nullptr) {
    if (count == EVENT_CAP) {   // oldest goes; the File can live without it
      head = (uint8_t)((head + 1) % EVENT_CAP);
      --count;
      ++dropped;
    }
    Event &e = items[(head + count) % EVENT_CAP];
    e.ms = ms; e.type = t; e.value = v;
    e.sval[0] = 0;
    if (s) { strncpy(e.sval, s, sizeof(e.sval) - 1); e.sval[sizeof(e.sval) - 1] = 0; }
    ++count;
  }
  const Event &at(int i) const { return items[(head + i) % EVENT_CAP]; }
  void drop(int n) {
    if (n > count) n = count;
    head = (uint8_t)((head + n) % EVENT_CAP);
    count = (uint8_t)(count - n);
  }
};
