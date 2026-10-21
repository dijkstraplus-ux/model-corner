# Slice a 4x4 walking sprite sheet (rows: down, left, right, up; cols: 4 walk frames) into an aligned atlas.
# usage: slice_sheet.py <sheet.png> <out-prefix>   -> <out>.png (atlas 4x4) + <out>.json
import sys, json
import numpy as np
from PIL import Image
from scipy import ndimage

src, out = sys.argv[1], sys.argv[2]
rows_names = sys.argv[3].split(',') if len(sys.argv) > 3 else ['down', 'left', 'right', 'up']
keep_props = len(sys.argv) > 4 and sys.argv[4] == 'props'
R, C = map(int, (sys.argv[5] if len(sys.argv) > 5 else '4x4').split('x'))
im = np.array(Image.open(src).convert('RGBA'))
H, W = im.shape[:2]
alpha = im[..., 3].astype(np.int32)

# 1. clean alpha: drop the faint ground shadow / speckles, make the body fully opaque
mask = alpha > 60
lab, n = ndimage.label(ndimage.binary_dilation(mask, iterations=2))
sizes = ndimage.sum(np.ones_like(mask), lab, range(1, n + 1))
keep = np.zeros(n + 1, bool); keep[1:] = sizes > 1500
mask &= keep[lab]
a2 = np.where(mask, np.where(alpha >= 200, 255, alpha), 0).astype(np.uint8)
im[..., 3] = a2

# 2. rows: split at the 3 emptiest horizontal bands near H/4, H/2, 3H/4
rowsum = (a2 > 0).sum(1).astype(float)
def cut(profile, nominal, span):
    lo, hi = int(nominal - span), int(nominal + span)
    seg = profile[lo:hi]
    return lo + int(np.argmin(np.convolve(seg, np.ones(9) / 9, 'same')))
rb = [0] + [cut(rowsum, H * k / R, H * 0.3 / R) for k in range(1, R)] + [H]

frames = []
for r in range(R):
    band = a2[rb[r]:rb[r + 1]]
    colsum = (band > 0).sum(0).astype(float)
    cb = [0] + [cut(colsum, W * k / C, W * 0.28 / C) for k in range(1, C)] + [W]
    for c in range(C):
        cell = im[rb[r]:rb[r + 1], cb[c]:cb[c + 1]].copy()
        m = cell[..., 3] > 0
        # the biggest blob is the character; keep props (lightbulb, stars) unless they touch the side edges,
        # which means they are bits of a neighbouring frame that leaked across the cut
        lab, n = ndimage.label(ndimage.binary_dilation(m, iterations=6))
        big = 1
        if n > 1:
            sizes = ndimage.sum(m, lab, range(1, n + 1))
            big = 1 + int(np.argmax(sizes))
            keep = np.zeros(n + 1, bool); keep[big] = True
            for k in range(1, n + 1):
                if k == big or not keep_props or sizes[k - 1] < sizes.max() * 0.004:
                    continue
                sel = (lab == k) & m
                xs_k = np.nonzero(sel)[1]
                solid = (cell[..., 3][sel] >= 200).mean()
                keep[k] = solid > 0.5 and xs_k.min() > 3 and xs_k.max() < cell.shape[1] - 4
            cell[..., 3] = np.where(keep[lab], cell[..., 3], 0)
            m = cell[..., 3] > 0
        main = m & (lab == big)
        ys, xs = np.nonzero(main)
        y0b, y1b, x0b, x1b = ys.min(), ys.max(), xs.min(), xs.max()
        ys_all, xs_all = np.nonzero(m)
        # anchor (from the character only): feet = lowest row in the middle third; x = head centre (top 35%)
        top = y0b + int((y1b - y0b) * 0.35)
        hx = xs[ys < top].mean()
        mid = (xs > x0b + (x1b - x0b) * 0.25) & (xs < x0b + (x1b - x0b) * 0.75)
        feet = ys[mid].max()
        frames.append(dict(img=cell, x0=xs_all.min(), x1=xs_all.max(), y0=ys_all.min(), y1=ys_all.max(), ax=hx, ay=feet))

# 3. uniform cells: anchor at bottom-centre
left = max(f['ax'] - f['x0'] for f in frames); right = max(f['x1'] - f['ax'] for f in frames)
up = max(f['ay'] - f['y0'] for f in frames); down = max(f['y1'] - f['ay'] for f in frames)
pad = 6
cw = int(2 * max(left, right) + 2 * pad); ch = int(up + down + 2 * pad)
ax, ay = cw // 2, int(up + pad)
atlas = Image.new('RGBA', (cw * C, ch * R), (0, 0, 0, 0))
for i, f in enumerate(frames):
    r, c = divmod(i, C)
    tile = Image.fromarray(f['img'])
    atlas.alpha_composite(tile, (int(c * cw + ax - f['ax']), int(r * ch + ay - f['ay'])))
atlas.save(out + '.png')
meta = dict(cell=[cw, ch], anchor=[ax, ay], rows=rows_names, frames=C, source=src)
json.dump(meta, open(out + '.json', 'w'))
print(out, 'cell', cw, ch, 'anchor', ax, ay, 'rows', rb)
