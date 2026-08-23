#pragma once
#include <stdint.h>

// A key with a short press and a long press. Lives in a header because the
// Arduino preprocessor injects prototypes above the .ino body (the creature
// repo's "auto-prototype trap"): a type used in a .ino function signature
// must be declared in a header.
struct Key {
  uint8_t pin;
  bool down;
  uint32_t downMs;
  bool longFired;
  uint32_t lastEdgeMs;
};
