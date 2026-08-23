#!/usr/bin/env python3
"""Rasterise the lying-down potato from assets/potato-look-v1.svg into the
e-paper portrait masks (firmware/paper/portrait.h).

    python3 firmware/tools/make_portrait.py > firmware/paper/portrait.h

Two sizes: the 140 px potato that is the page, and a 36x26 one for the
unregistered page. Each is three 1-bit masks (body, underside shade,
highlight) plus the face geometry in pixels: eye centres and radii for each
expression (ovals, slits, arcs, wide, the glance), the dimples, and the King
Edward flecks. The firmware combines the masks with a variety's dither and
ink at draw time; nothing here is tied to a variety. Standard library only.
"""
import re, sys

SS = 4  # supersamples per axis

# The #body path from the SVG, in the SVG's own units (centre-origin).
PATH = ("M -100,6 C -106,-38 -62,-74 -12,-72 C 38,-70 92,-56 104,-12 "
        "C 112,26 82,66 26,71 C -30,76 -94,54 -100,6 Z")
SHADE = (22, 44, 112, 62)      # cx, cy, rx, ry (clipped to body)
HILITE = (-42, -34, 58, 28)
EYES = [(-28, -14), (22, -17)]
DIMPLES = [(62, 22), (-62, 34), (30, 52), (-70, -20)]

def flatten(path, steps=24):
    nums = [float(t) for t in re.findall(r"-?\d+\.?\d*", path)]
    pts = [(nums[0], nums[1])]
    i = 2
    while i + 5 < len(nums):
        x0, y0 = pts[-1]
        x1, y1, x2, y2, x3, y3 = nums[i:i + 6]
        for s in range(1, steps + 1):
            t = s / steps
            a, b, c, d = (1 - t) ** 3, 3 * (1 - t) ** 2 * t, 3 * (1 - t) * t ** 2, t ** 3
            pts.append((a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3))
        i += 6
    return pts

poly = flatten(PATH)
xs = [p[0] for p in poly]; ys = [p[1] for p in poly]
minx, maxx, miny, maxy = min(xs), max(xs), min(ys), max(ys)
FLECKS = [(50, -30, 9, 5), (-55, 20, 7, 4), (40, 45, 8, 4)]   # King Edward, from panel 4
EYE = (7, 9)          # neutral oval radii, SVG units
SLIT = (8, 3.2, 3)    # aggrieved: rx, ry, y shift down
WIDE = (8.5, 11.5)    # alarmed
ARC = (8, 3)          # asleep: half width, depth
GLANCE_DX = 10        # eyes toward the edge when the File has news

def inside(poly, x, y):
    c = False
    n = len(poly)
    for i in range(n):
        x1, y1 = poly[i]; x2, y2 = poly[(i + 1) % n]
        if (y1 > y) != (y2 > y):
            xi = x1 + (y - y1) * (x2 - x1) / (y2 - y1)
            if x < xi: c = not c
    return c

def in_ellipse(e, x, y):
    cx, cy, rx, ry = e[:4]
    return ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1.0

def emit_size(W, H, prefix):
    scale = min((W - 1) / (maxx - minx), (H - 1) / (maxy - miny))
    ox = (W - (maxx - minx) * scale) / 2 - minx * scale
    oy = (H - (maxy - miny) * scale) / 2 - miny * scale
    def to_px(x, y): return x * scale + ox, y * scale + oy
    def mask(pred):
        rows = []
        for py in range(H):
            row = []
            for px in range(W):
                hits = 0
                for sy in range(SS):
                    for sx in range(SS):
                        x = (px + (sx + 0.5) / SS - ox) / scale
                        y = (py + (sy + 0.5) / SS - oy) / scale
                        if pred(x, y): hits += 1
                row.append(1 if hits * 2 >= SS * SS else 0)
            rows.append(row)
        return rows
    body = mask(lambda x, y: inside(poly, x, y))
    shade = mask(lambda x, y: inside(poly, x, y) and in_ellipse(SHADE, x, y))
    hi = mask(lambda x, y: inside(poly, x, y) and in_ellipse(HILITE, x, y))
    stride = (W + 7) // 8
    def emit(name, rows):
        print("static const uint8_t %s[%d][%d] = {" % (name, H, stride))
        for row in rows:
            bytes_ = []
            for b in range(stride):
                v = 0
                for bit in range(8):
                    x = b * 8 + bit
                    if x < W and row[x]: v |= 0x80 >> bit
                bytes_.append("0x%02X" % v)
            print("    {%s}," % ", ".join(bytes_))
        print("};")
    r = lambda v: int(round(v))
    print("#define %s_W %d" % (prefix, W))
    print("#define %s_H %d" % (prefix, H))
    print("#define %s_STRIDE %d" % (prefix, stride))
    emit(prefix + "_BODY", body)
    emit(prefix + "_SHADE", shade)
    emit(prefix + "_HI", hi)
    print("static const int8_t %s_EYES[2][2] = {%s};" % (prefix, ", ".join(
        "{%d, %d}" % tuple(r(v) for v in to_px(*e)) for e in EYES)))
    print("static const uint8_t %s_EYE_R[2] = {%d, %d};       // neutral oval rx, ry" % (prefix, max(1, r(EYE[0] * scale)), max(1, r(EYE[1] * scale))))
    print("static const uint8_t %s_SLIT[3] = {%d, %d, %d};    // aggrieved rx, ry, y shift" % (prefix, max(1, r(SLIT[0] * scale)), max(1, r(SLIT[1] * scale)), r(SLIT[2] * scale)))
    print("static const uint8_t %s_WIDE[2] = {%d, %d};       // alarmed rx, ry" % (prefix, max(1, r(WIDE[0] * scale)), max(1, r(WIDE[1] * scale))))
    print("static const uint8_t %s_ARC[2] = {%d, %d};        // asleep half width, depth" % (prefix, max(1, r(ARC[0] * scale)), max(1, r(ARC[1] * scale))))
    print("static const uint8_t %s_GLANCE_DX = %d;" % (prefix, max(1, r(GLANCE_DX * scale))))
    print("static const int8_t %s_DIMPLES[%d][4] = {%s};    // x, y, rx, ry" % (prefix, len(DIMPLES), ", ".join(
        "{%d, %d, %d, %d}" % (r(to_px(*d)[0]), r(to_px(*d)[1]), max(1, r(5 * scale)), max(1, r(3 * scale))) for d in DIMPLES)))
    print("static const int8_t %s_FLECKS[%d][4] = {%s};     // King Edward: x, y, rx, ry" % (prefix, len(FLECKS), ", ".join(
        "{%d, %d, %d, %d}" % (r(to_px(f[0], f[1])[0]), r(to_px(f[0], f[1])[1]), max(1, r(f[2] * scale)), max(1, r(f[3] * scale))) for f in FLECKS)))
    for row in body:
        sys.stderr.write("".join("#" if v else "." for v in row) + "\n")
    sys.stderr.write("\n")

print("#pragma once")
print("#include <stdint.h>")
print("// Generated by firmware/tools/make_portrait.py from assets/potato-look-v1.svg.")
print("// The lying-down potato: body, underside shade and highlight masks (MSB")
print("// first), face geometry in pixels. POTATO_* is the page (140 px wide);")
print("// PORTRAIT_* is the small one for the unregistered page.")
emit_size(140, 96, "POTATO")
emit_size(36, 26, "PORTRAIT")
