#pragma once
#include <stdint.h>

// The Adafruit GFX font structs, and nothing else, so the bundled font
// tables (BSD) compile on the device and in the host preview tool without
// Adafruit_GFX. Guarded with Adafruit's own macro so both can coexist.

#ifdef ARDUINO
#include <pgmspace.h>
#else
#ifndef PROGMEM
#define PROGMEM
#endif
#endif

#ifndef _GFXFONT_H_
#define _GFXFONT_H_
typedef struct {
  uint16_t bitmapOffset;
  uint8_t width, height, xAdvance;
  int8_t xOffset, yOffset;
} GFXglyph;

typedef struct {
  uint8_t *bitmap;
  GFXglyph *glyph;
  uint16_t first, last;
  uint8_t yAdvance;
} GFXfont;
#endif
