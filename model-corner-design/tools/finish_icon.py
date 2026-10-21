#!/usr/bin/env python3
"""Finish the flat whale icon: decode the flattened PNG, add an eye and a spout.

Stdlib only (zlib + struct). Circles are drawn antialiased by 4x supersampling
inside a small bounding box, so it stays cheap.
"""
import math
import struct
import sys
import zlib

SRC, OUT = sys.argv[1], sys.argv[2]
NAVY = (22, 35, 63)
WHALE = (126, 200, 245)
EYE = (242, 248, 255)


def read_png(path):
    data = open(path, "rb").read()
    pos = 8
    w = h = None
    idat = b""
    while pos < len(data):
        ln = struct.unpack(">I", data[pos:pos + 4])[0]
        tag = data[pos + 4:pos + 8]
        body = data[pos + 8:pos + 8 + ln]
        pos += 12 + ln
        if tag == b"IHDR":
            w, h, depth, ctype = struct.unpack(">IIBB", body[:10])
            assert depth == 8 and ctype in (2, 6), (depth, ctype)
        elif tag == b"IDAT":
            idat += body
    bpp = 4 if ctype == 6 else 3
    raw = zlib.decompress(idat)
    stride = w * bpp
    out = bytearray(h * stride)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        f = raw[p]
        p += 1
        line = bytearray(raw[p:p + stride])
        p += stride
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if f == 1:
                line[i] = (line[i] + a) & 255
            elif f == 2:
                line[i] = (line[i] + b) & 255
            elif f == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif f == 4:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                pr = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                line[i] = (line[i] + pr) & 255
        out[y * stride:(y + 1) * stride] = line
        prev = line
    return w, h, bpp, out


def write_png(path, w, h, px):
    def chunk(tag, data):
        return (struct.pack(">I", len(data)) + tag + data
                + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF))

    raw = bytearray()
    for y in range(h):
        raw.append(0)
        raw += px[y * w * 4:(y + 1) * w * 4]
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        f.write(chunk(b"IEND", b""))


def blend(px, w, x, y, col, a):
    if a <= 0 or not (0 <= x < w) or not (0 <= y < w):
        return
    i = (y * w + x) * 4
    for k in range(3):
        px[i + k] = int(px[i + k] + (col[k] - px[i + k]) * a + 0.5)


def disc(px, w, cx, cy, r, col, aa=6.0):
    x0, x1 = int(cx - r - 2), int(cx + r + 2)
    y0, y1 = int(cy - r - 2), int(cy + r + 2)
    for y in range(max(0, y0), min(w, y1 + 1)):
        for x in range(max(0, x0), min(w, x1 + 1)):
            d = math.hypot(x + 0.5 - cx, y + 0.5 - cy)
            a = max(0.0, min(1.0, (r - d) / aa + 0.5))
            blend(px, w, x, y, col, a)


def main():
    w, h, bpp, raw = read_png(SRC)
    px = bytearray(w * h * 4)
    for y in range(h):
        for x in range(w):
            s = (y * w + x) * bpp
            d = (y * w + x) * 4
            g = raw[s + 1]
            # anything clearly lighter than the navy plate is whale
            col = WHALE if g > 120 else NAVY
            px[d:d + 3] = bytes(col)
            px[d + 3] = 255

    # eye: inside the head, upper-right of the body
    disc(px, w, w * 0.775, h * 0.605, w * 0.032, EYE)
    # spout: a short plume over the blowhole
    bx, by = w * 0.775, h * 0.40
    for k, (dx, dy, rr) in enumerate(((0, 0, 0.028), (0.012, -0.075, 0.033),
                                     (0.035, -0.135, 0.024), (-0.02, -0.11, 0.016),
                                     (0.075, -0.10, 0.014))):
        disc(px, w, bx + w * dx, by + h * dy, w * rr, WHALE)
    write_png(OUT, w, h, px)
    print("wrote", OUT, w, "x", h)


if __name__ == "__main__":
    main()
