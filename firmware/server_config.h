#pragma once

#include <stddef.h>
#include <string.h>

static const char *LEGACY_LAN_SERVER_URL = "http://potatoes.local:8080";

// Select the URL this build should use. A public build carries citizens off
// the original LAN default, but an explicitly configured custom Net remains
// authoritative. Returns true only when the stored value must be persisted as
// the build default.
static bool selectServerUrl(const char *stored, const char *buildDefault,
                            char *out, size_t outSize) {
  if (!out || outSize == 0) return false;
  if (!stored) stored = "";
  if (!buildDefault) buildDefault = "";

  const bool migrate =
      strcmp(stored, LEGACY_LAN_SERVER_URL) == 0 &&
      strcmp(buildDefault, LEGACY_LAN_SERVER_URL) != 0;
  const char *selected = (!stored[0] || migrate) ? buildDefault : stored;
  strncpy(out, selected, outSize - 1);
  out[outSize - 1] = 0;
  return migrate;
}
