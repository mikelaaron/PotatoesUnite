#pragma once

#include <math.h>

// Lives in a header, not the .ino, on purpose.
//
// The Arduino preprocessor auto-generates prototypes for every function in a
// .ino and injects them directly after the last #include. A function taking a
// type declared later in the same .ino therefore gets a prototype referencing
// an undeclared type, and the build fails with "variable or field declared
// void". Types used in .ino function signatures belong in a header.

struct Spring {
  float x = 0.0f;
  float v = 0.0f;
};

// Damped spring toward a target. The exponential decay on velocity keeps this
// stable at any frame rate, unlike a raw `v -= v * c * dt`, which blows up if a
// frame runs long.
static inline void springTo(Spring &s, float target, float k, float c, float dt) {
  s.v += (target - s.x) * k * dt;
  s.v *= expf(-c * dt);
  s.x += s.v * dt;
}
