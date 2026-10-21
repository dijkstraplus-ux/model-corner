# Cutout v2: rembg(isnet-anime) mask + hole repair.
# rembg tends to punch holes in white/pastel areas (white hair, frills) that resemble the pastel background.
# Fill enclosed holes unless the hole really is background (colour close to the border colour).
import sys, pathlib
import numpy as np
from PIL import Image
from rembg import remove, new_session
from scipy import ndimage

src_dir, out_dir = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
T = float(sys.argv[3]) if len(sys.argv) > 3 else 12.0
out_dir.mkdir(parents=True, exist_ok=True)
cache = out_dir / '_alpha'; cache.mkdir(exist_ok=True)
session = None

def disk(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r

for f in sorted(src_dir.glob('chibi-*.png')):
    name = f.stem.replace('chibi-', '')
    rgb = np.array(Image.open(f).convert('RGB')).astype(np.float32)
    ap = cache / f'{name}.npy'
    if ap.exists():
        alpha0 = np.load(ap)
    else:
        session = session or new_session('isnet-anime')
        alpha0 = np.array(remove(Image.fromarray(rgb.astype(np.uint8)), session=session, only_mask=True, post_process_mask=False))
        np.save(ap, alpha0)
    h, w = alpha0.shape
    border = np.concatenate([rgb[:12].reshape(-1, 3), rgb[-12:].reshape(-1, 3), rgb[:, :12].reshape(-1, 3), rgb[:, -12:].reshape(-1, 3)])
    bg = np.median(border, axis=0)

    m0 = alpha0 > 96
    lab, n = ndimage.label(m0)
    sizes = ndimage.sum(np.ones_like(m0), lab, range(1, n + 1))
    m0 = np.isin(lab, 1 + np.nonzero(sizes >= sizes.max() * 0.02)[0])   # drop bubbles / sparkles
    closed = ndimage.binary_closing(m0, structure=disk(4))
    filled = ndimage.binary_fill_holes(closed)
    holes, nh = ndimage.label(filled & ~closed)
    dist = np.sqrt(((rgb - bg) ** 2).sum(-1))
    keep_open = np.zeros(nh + 1, bool)
    if nh:
        areas = ndimage.sum(np.ones_like(holes), holes, range(1, nh + 1))
        mean_d = ndimage.mean(dist, holes, range(1, nh + 1))
        for k in range(nh):
            keep_open[k + 1] = areas[k] > 150 and mean_d[k] < T
        n_open = int(keep_open.sum())
    else:
        n_open = 0
    mask = filled & ~keep_open[holes]
    core = ndimage.binary_erosion(mask, iterations=2)
    edge = ndimage.binary_dilation(mask, iterations=1) & ~core
    alpha = np.where(core, 255, np.where(edge, alpha0, 0)).astype(np.uint8)

    ys, xs = np.nonzero(alpha > 10)
    y0, y1, x0, x1 = max(ys.min() - 4, 0), min(ys.max() + 5, h), max(xs.min() - 4, 0), min(xs.max() + 5, w)
    out = np.dstack([rgb.astype(np.uint8), alpha])[y0:y1, x0:x1]
    Image.fromarray(out).save(out_dir / f'{name}.png')
    print(f'{name:9s} {x1 - x0}x{y1 - y0} bg={bg.astype(int)} holes={nh} kept_open={n_open}')
