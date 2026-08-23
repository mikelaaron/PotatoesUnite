#!/usr/bin/env python3
"""PPM (P6) to PNG with only the standard library, for previews.

    python3 firmware/tools/ppm2png.py in.ppm [out.png]
"""
import struct, sys, zlib

src = sys.argv[1]
dst = sys.argv[2] if len(sys.argv) > 2 else src.rsplit(".", 1)[0] + ".png"
with open(src, "rb") as f:
    data = f.read()
parts = data.split(b"\n", 3)
w, h = (int(v) for v in parts[1].split())
pix = parts[3]
raw = b"".join(b"\x00" + pix[y * w * 3:(y + 1) * w * 3] for y in range(h))

def chunk(tag, body):
    return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)

png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) + \
    chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")
with open(dst, "wb") as f:
    f.write(png)
print(dst)
