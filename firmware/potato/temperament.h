#pragma once

// Temperament is data, not code. The renderer never reads this struct; only
// the behaviour update does.
//
// Lives in a header because the Arduino preprocessor injects generated
// prototypes above the .ino body — see spring.h for the full explanation.

struct Temperament {
  float reactionGain;      // how hard a stimulus lands, 0..1
  float arousalDecay;      // per-second decay of excitement
  float habituationGain;   // how fast it gets used to being handled
  float habituationDecay;  // per-second recovery of novelty
  float habituationFloor;  // most of a reaction habituation can ever remove

  float breathRate;        // radians/sec at rest
  float breathDepth;       // fraction of radius

  float blinkMin, blinkMax;    // seconds between blinks at rest
  float glanceMin, glanceMax;  // seconds between idle glances down at the line

  float gazeRange;         // how far the eyes move, fraction of body radius
  float gazeSettle;        // spring constant for eye movement

  float perkHeight;        // body stretch when stirred
};

// A potato is not eager. It is aggrieved, and it breathes slowly. Handling
// still registers — the eyes widen a little and the breath quickens — but it
// settles fast and it does not perform.
static const Temperament POTATO = {
    .reactionGain = 0.55f,
    .arousalDecay = 0.70f,
    .habituationGain = 0.45f,
    .habituationDecay = 0.0040f,
    .habituationFloor = 0.85f,

    .breathRate = 0.90f,
    .breathDepth = 0.020f,

    .blinkMin = 3.0f,
    .blinkMax = 9.0f,
    .glanceMin = 7.0f,
    .glanceMax = 16.0f,

    .gazeRange = 0.10f,
    .gazeSettle = 90.0f,

    .perkHeight = 0.030f,
};
