# Turn a transparent VP9 WebM (e.g. a dsh-pet action clip) into a frame atlas for frame-by-frame playback.
# usage: webm_to_atlas.py <in.webm> <out-prefix> [fps=8] [height=240] [cols=10]
import sys, json, subprocess, tempfile, pathlib
import numpy as np
from PIL import Image

src, out = sys.argv[1], sys.argv[2]
fps = float(sys.argv[3]) if len(sys.argv) > 3 else 8
th = int(sys.argv[4]) if len(sys.argv) > 4 else 240
cols = int(sys.argv[5]) if len(sys.argv) > 5 else 10
tmp = pathlib.Path(tempfile.mkdtemp())
subprocess.run(['ffmpeg', '-loglevel', 'error', '-c:v', 'libvpx-vp9', '-i', src, '-vf', f'fps={fps}', '-pix_fmt', 'rgba', str(tmp / 'f%04d.png')], check=True)
frames = [np.array(Image.open(p).convert('RGBA')) for p in sorted(tmp.glob('f*.png'))]
occ = np.zeros(frames[0].shape[:2], bool)
for f in frames:
    occ |= f[..., 3] > 24
ys, xs = np.nonzero(occ)
y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
# feet baseline: lowest occupied row of the union; keep a symmetric crop around the clip centre
cx = (x0 + x1) / 2
half = max(cx - x0, x1 - cx)
x0, x1 = int(max(cx - half, 0)), int(min(cx + half, frames[0].shape[1]))
scale = th / (y1 - y0)
cw, ch = int(round((x1 - x0) * scale)), th
rows = (len(frames) + cols - 1) // cols
atlas = Image.new('RGBA', (cw * cols, ch * rows), (0, 0, 0, 0))
for i, f in enumerate(frames):
    a = f.copy(); a[..., 3] = np.where(a[..., 3] > 24, a[..., 3], 0)
    tile = Image.fromarray(a[y0:y1, x0:x1]).resize((cw, ch), Image.LANCZOS)
    atlas.alpha_composite(tile, ((i % cols) * cw, (i // cols) * ch))
atlas.save(out + '.webp', 'WEBP', quality=72, method=6)
json.dump(dict(cell=[cw, ch], anchor=[cw // 2, ch - 1], frames=len(frames), cols=cols, fps=fps, source=src), open(out + '.json', 'w'))
print(out, len(frames), 'frames', cw, 'x', ch, pathlib.Path(out + '.webp').stat().st_size // 1024, 'KB')
