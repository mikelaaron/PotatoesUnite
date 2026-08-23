// Host preview of the potato rasterizer: renders one frame of the body,
// dimples and eyes exactly as the firmware does and writes a PPM.
//
//   c++ -std=c++11 -I firmware/potato firmware/tools/render_preview.cpp -o /tmp/pp
//   /tmp/pp out.ppm [lean_deg] [expression 0..6] [blink 0..1]
//
// Expression numbers follow enum Expression in potato_shape.h.
#include <stdio.h>
#include <stdlib.h>
#include "potato_shape.h"
#include "raster.h"

static const int W = 368, H = 448;

int main(int argc, char **argv) {
  const char *out = argc > 1 ? argv[1] : "preview.ppm";
  const float th = (argc > 2 ? atof(argv[2]) : 0.0f) * 3.14159265f / 180.0f;
  const Expression expr = (Expression)(argc > 3 ? atoi(argv[3]) : 0);
  const float blink = argc > 4 ? atof(argv[4]) : 0.0f;
  const PotatoShape &S = RUSSET;
  const EyePose pose = eyePoseFor(expr);
  static uint16_t fb[W * H];
  win = (uint16_t *)calloc(MAX_RECT * MAX_RECT, 2);

  const float bx = 184.0f, by = 146.0f, sx = S.rx, sy = S.ry;
  const float ct = cosf(th), st = sinf(th);
  potatoOutline(S, bx, by, sx, sy, th);
  static BodyPaint paint;
  setupBodyPaint(paint, S, bx, by, sx, sy, th, pose.dim);
  const uint16_t ink = mixColor(0x0000, S.ink, pose.dim);
  const uint16_t dimple = mixColor(0x0000, S.dimple, pose.dim);

  for (int ty = 0; ty < H; ty += MAX_RECT) {
    for (int tx = 0; tx < W; tx += MAX_RECT) {
      const int tw = W - tx < MAX_RECT ? W - tx : MAX_RECT;
      const int thh = H - ty < MAX_RECT ? H - ty : MAX_RECT;
      setWindow(tx, ty, tw, thh);
      memset(win, 0, (size_t)tw * thh * 2);
      potatoFill(paint);
      for (int i = 0; i < POTATO_DIMPLES; ++i) {
        const Dimple &d = S.dimples[i];
        float px, py;
        bodyToScreen(bx, by, ct, st, d.x * sx, d.y * sy, &px, &py);
        ellipseRot(px, py, d.rx * sx, d.ry * sx, th + d.rot, dimple);
      }
      for (int i = 0; i < 2; ++i) {
        const float lx = S.eyeX[i] * sx, ly = (S.eyeY[i] + pose.dy) * sy;
        const float erx = S.eyeRX[i] * sx * pose.scaleX;
        const float ery = S.eyeRY[i] * sy * pose.scaleY;
        if (pose.closed || blink > 0.92f) {
          float x0, y0, x1, y1, qx, qy;
          bodyToScreen(bx, by, ct, st, lx - erx * 1.15f, ly, &x0, &y0);
          bodyToScreen(bx, by, ct, st, lx + erx * 1.15f, ly, &x1, &y1);
          bodyToScreen(bx, by, ct, st, lx, ly + ery * 0.65f, &qx, &qy);
          arcStroke(x0, y0, qx, qy, x1, y1, 1.6f, ink);
        } else {
          float px, py;
          bodyToScreen(bx, by, ct, st, lx, ly, &px, &py);
          ellipseRot(px, py, erx, fmaxf(ery * (1.0f - blink), 1.0f), th, ink);
        }
      }
      for (int y = 0; y < thh; ++y)
        for (int x = 0; x < tw; ++x) fb[(ty + y) * W + tx + x] = win[y * tw + x];
    }
  }

  FILE *f = fopen(out, "wb");
  fprintf(f, "P6\n%d %d\n255\n", W, H);
  for (int i = 0; i < W * H; ++i) {
    const uint16_t c = fb[i];
    const unsigned char rgb[3] = {(unsigned char)(((c >> 11) & 0x1F) * 255 / 31),
                                  (unsigned char)(((c >> 5) & 0x3F) * 255 / 63),
                                  (unsigned char)((c & 0x1F) * 255 / 31)};
    fwrite(rgb, 1, 3, f);
  }
  fclose(f);
  return 0;
}
