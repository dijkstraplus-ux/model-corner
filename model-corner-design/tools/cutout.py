# Cut chibi characters out of their backgrounds with rembg (isnet-anime), keep the largest blob, trim, save RGBA PNG.
import sys, pathlib
import numpy as np
from PIL import Image
from rembg import remove, new_session
from scipy import ndimage

src_dir, out_dir = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
out_dir.mkdir(parents=True, exist_ok=True)
session = new_session('isnet-anime')
for f in sorted(src_dir.glob('chibi-*.png')):
    img = Image.open(f).convert('RGB')
    cut = remove(img, session=session, post_process_mask=True)
    a = np.array(cut)
    alpha = a[..., 3]
    lab, n = ndimage.label(alpha > 40)
    if n > 1:
        sizes = ndimage.sum(np.ones_like(alpha), lab, range(1, n + 1))
        keep = np.zeros(n + 1, bool)
        big = sizes.max()
        for k, s in enumerate(sizes, 1):
            keep[k] = s >= big * 0.02  # drop bubbles / sparkles, keep detached accessories of meaningful size
        kept = ndimage.binary_dilation(keep[lab], iterations=3)
        a[..., 3] = np.where(kept, alpha, 0)
    ys, xs = np.nonzero(a[..., 3] > 10)
    a = a[max(ys.min() - 6, 0):ys.max() + 7, max(xs.min() - 6, 0):xs.max() + 7]
    out = out_dir / f.name.replace('chibi-', '')
    Image.fromarray(a).save(out)
    print(out.name, a.shape[1], 'x', a.shape[0], 'blobs', n)
