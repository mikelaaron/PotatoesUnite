#pragma once

struct Rect {
  int x0, y0, x1, y1;  // inclusive
};

static inline Rect unionRect(Rect a, Rect b) {
  if (a.x1 < a.x0) return b;
  if (b.x1 < b.x0) return a;
  if (b.x0 < a.x0) a.x0 = b.x0;
  if (b.y0 < a.y0) a.y0 = b.y0;
  if (b.x1 > a.x1) a.x1 = b.x1;
  if (b.y1 > a.y1) a.y1 = b.y1;
  return a;
}
