#!/usr/bin/env python3
"""Whale Lane (鲸巷) space icon: 32x32 pixel art, blown up to 512x512.

Drawn on a character grid so it matches the town's pixel sprites.
Only the stdlib is used (zlib + struct write the PNG).
"""
import struct
import sys
import zlib

OUT = sys.argv[1] if len(sys.argv) > 1 else "whale-lane-icon.png"
GRID = 32
SCALE = 16
SIZE = GRID * SCALE

# palette, kept close to the town art
COLORS = {
    ".": (35, 42, 69),      # night navy
    "n": (27, 32, 54),      # deeper navy
    "w": (246, 236, 221),   # whale cream
    "k": (43, 36, 64),      # ink
    "t": (89, 169, 163),    # teal belly
    "c": (127, 200, 192),   # spout
    "g": (226, 168, 74),    # lantern gold
    "l": (255, 214, 142),   # lantern light
    "s": (217, 201, 168),   # stars
    "r": (226, 168, 74),    # lane line
}

ART = """
................................
................................
...........s.........s..........
................................
................................
.....g..........................
.....l..........................
................................
..................c.............
.................c.c............
...............cc...............
................................
.........wwwwwwwwwwww...........
.......wwwwwwwwwwwwwwwww........
......wwwwwwwwwwwwwwwwwwww......
..w...wwwwwwwwwwwwwwwwwwwww.....
..ww.wwwwwwwwwwwwwwwwwwwwwww....
.www.wwwwwwwwwwwwwwwwkwwwwww....
.www.wwwwwwwwwwwwwwwwwwwwww.....
..ww.wwwwwwwwwwwwwwwwwwww.......
...w..wwwwwwwwwwwwwwwwww........
.......wwwwwwwwwwwwwwwtt........
........wwwwwwwwwwwtttt.........
..........wwwwwwwttt............
.............www................
................................
................................
................................
................................
................................
................................
""".strip("\n").split("\n")

FRAME_ROWS = (30, 31)


def build():
    rows = [list(r.ljust(GRID, ".")[:GRID]) for r in ART]
    while len(rows) < GRID:
        rows.append(["."] * GRID)
    # lane line across the bottom, two rows, with a gap under the whale
    for y in FRAME_ROWS:
        for x in range(GRID):
            if rows[y][x] == ".":
                rows[y][x] = "r"
    return rows


def px(rows):
    out = bytearray()
    for y in range(SIZE):
        out.append(0)
        gy = y // SCALE
        fy = (y % SCALE) / SCALE
        for x in range(SIZE):
            gx = x // SCALE
            fx = (x % SCALE) / SCALE
            base = COLORS[rows[gy][gx]]
            # soft edges so the icon does not look like a hard checkerboard
            edge = min(fx, 1 - fx, fy, 1 - fy)
            if edge < 0.14 and rows[gy][gx] != ".":
                col = COLORS[rows[gy][gx]]
                mix = 0.25 * (1 - edge / 0.14)
                base = tuple(base[i] + (COLORS["."][i] - col[i]) * mix + (col[i] - base[i]) * 0 for i in range(3))
            out += bytes((int(base[0]), int(base[1]), int(base[2]), 255))
    return out


def write_png(path, raw, w, h):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)))
        f.write(chunk(b"IDAT", zlib.compress(bytes(raw), 9)))
        f.write(chunk(b"IEND", b""))


if __name__ == "__main__":
    rows = build()
    for i, r in enumerate(rows):
        assert len(r) == GRID, (i, len(r))
    write_png(OUT, px(rows), SIZE, SIZE)
    print("wrote", OUT)
