"""Zoom into part of a map with its region ids and the current walk grid, for reviewing walkmask.py output.

    walkzoom.py <area> x0,y0,x1,y1 <out.jpg> [zoom]
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from skimage.segmentation import find_boundaries

area, box, out = sys.argv[1:4]
k = float(sys.argv[4]) if len(sys.argv) > 4 else 2
x0, y0, x1, y1 = (int(v) for v in box.split(','))
im = np.asarray(Image.open(f'demo2/assets/{area}.webp').convert('RGB'))
lab = np.load(f'nav/work-{area}/regions.npy')
g = np.asarray(Image.open(f'nav/{area}.png')) > 0
big = np.kron(g, np.ones((8, 8), bool))
crop = im[y0:y1, x0:x1].astype(np.float32)
m = big[y0:y1, x0:x1]
crop[m] = crop[m] * 0.6 + np.array([60, 255, 120]) * 0.4
crop[find_boundaries(lab[y0:y1, x0:x1], mode='inner')] = [255, 0, 255]
c = Image.fromarray(crop.astype(np.uint8)).resize((round((x1 - x0) * k), round((y1 - y0) * k)), Image.LANCZOS)
d = ImageDraw.Draw(c)
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 18)
for r, (x, y) in json.load(open(f'nav/work-{area}/reps.json')).items():
    if x0 <= x < x1 and y0 <= y < y1:
        d.text(((x - x0) * k, (y - y0) * k), r, font=f, fill=(255, 255, 255), anchor='mm', stroke_width=3, stroke_fill=(0, 0, 0))
c.save(out, quality=88)
