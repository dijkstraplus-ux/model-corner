"""Work out where characters can walk on a town map, so the game can find paths by itself.

    walkmask.py regions <map.webp> <seg.npz> <work_dir>
        cut the map into ~300 superpixels (regions that follow colour edges) and give each one a first guess,
        walkable or not, from the local SegFormer segmentation (tools/segment_map.py). Writes review images
        <work_dir>/review-<quadrant>.jpg: walkable regions tinted green, the rest red, every region numbered.
    walkmask.py build <map.webp> <work_dir> <fixes.json> <out.png> x,y [x,y ...]
        apply the reviewed corrections ({"walk": [ids], "block": [ids]}), keep only walkable ground connected to
        the seed points (area entrances and activity spots), close small gaps, pull back from obstacles and save
        the mask at 8 px per cell (white = walkable). Writes <work_dir>/walk-preview.jpg to check the result.

No model is called over the network; the first guess is local and a person (or agent) reviews it.
"""
import json
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage
from skimage.filters import gaussian
from skimage.segmentation import find_boundaries, slic

CELL = 8
FONT = '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
# ADE20K 里算「能走的地面」的类别：地板、路、草地、人行道、土地、地毯、田野、沙、小路、台阶、跑道、楼梯、桥、土路、陆地、舞台、毯子、码头
WALK = [3, 6, 9, 11, 13, 28, 29, 46, 52, 53, 54, 59, 61, 91, 94, 101, 121, 131, 140]


def regions(map_path, seg_path, work):
    im = np.asarray(Image.open(map_path).convert('RGB'))
    H, W = im.shape[:2]
    lab = slic(gaussian(im, sigma=1.5, channel_axis=-1), n_segments=420, compactness=14, start_label=0)
    np.save(f'{work}/regions.npy', lab)
    prob = np.load(seg_path)['prob'].astype(np.float32)  # (150, H/2, W/2)
    pw = prob[WALK].sum(0)
    pw = np.asarray(Image.fromarray(pw).resize((W, H), Image.BILINEAR))
    n = lab.max() + 1
    p = ndimage.mean(pw, lab, range(n))
    guess = {str(r): int(p[r] > 0.5) for r in range(n)}
    json.dump({'p_walk': [round(float(v), 3) for v in p], 'guess': guess}, open(f'{work}/labels.json', 'w'))
    # 编号写在每个区域里离边界最远的点
    reps = {}
    for r in range(n):
        m = lab == r
        sl = ndimage.find_objects(m.astype(np.int8))[0]
        dist = ndimage.distance_transform_edt(np.pad(m[sl], 1))[1:-1, 1:-1]
        y, x = np.unravel_index(dist.argmax(), dist.shape)
        reps[r] = (int(x + sl[1].start), int(y + sl[0].start))
    json.dump(reps, open(f'{work}/reps.json', 'w'))
    review(im, lab, guess, reps, work)
    print('regions', n, 'guessed walkable', sum(guess.values()))


def review(im, lab, walk, reps, work, suffix=''):
    H, W = lab.shape
    isw = np.zeros(lab.max() + 1, bool)
    for r, v in walk.items():
        isw[int(r)] = bool(v)
    tint = np.where(isw[lab][..., None], np.array([40, 255, 90]), np.array([255, 40, 40]))
    vis = im * 0.62 + tint * 0.38
    vis[find_boundaries(lab, mode='inner')] = [255, 0, 255]
    font = ImageFont.truetype(FONT, 15)
    for qy in (0, H // 2):
        for qx in (0, W // 2):
            crop = Image.fromarray(vis[qy:qy + H // 2, qx:qx + W // 2].astype(np.uint8))
            k = 1024 / crop.size[0]
            crop = crop.resize((1024, round(crop.size[1] * k)), Image.LANCZOS)
            d = ImageDraw.Draw(crop)
            for r, (x, y) in reps.items():
                if qx <= x < qx + W // 2 and qy <= y < qy + H // 2:
                    d.text(((x - qx) * k, (y - qy) * k), str(r), font=font, fill=(255, 255, 255), anchor='mm', stroke_width=3, stroke_fill=(0, 0, 0))
            crop.save(f'{work}/review{suffix}-{qx}-{qy}.jpg', quality=86)


def build(map_path, work, fixes_path, out, seeds):
    im = np.asarray(Image.open(map_path).convert('RGB'))
    lab = np.load(f'{work}/regions.npy')
    walk = dict(json.load(open(f'{work}/labels.json'))['guess'])
    fixes = json.load(open(fixes_path))
    for r in fixes.get('walk', []):
        walk[str(r)] = 1
    for r in fixes.get('block', []):
        walk[str(r)] = 0
    reps = {int(k): v for k, v in json.load(open(f'{work}/reps.json')).items()}
    review(im, lab, walk, reps, work, '-fixed')
    isw = np.zeros(lab.max() + 1, bool)
    for r, v in walk.items():
        isw[int(r)] = bool(v)
    mask = isw[lab]
    # 原画里有路、但被栏杆柱或一丛花隔开的地方，用连接线补一条窄通道
    if fixes.get('links'):
        m = Image.fromarray(mask.astype(np.uint8) * 255)
        d = ImageDraw.Draw(m)
        for x0, y0, x1, y1 in fixes['links']:
            d.line([(x0, y0), (x1, y1)], fill=255, width=30)
        mask = np.asarray(m) > 0
    # 补上区域之间的细缝，去掉孤立的小块
    mask = ndimage.binary_closing(mask, np.ones((17, 17)))  # 细杆子、栏杆柱留下的窄缝也连上
    mask = ndimage.binary_opening(mask, np.ones((7, 7)), border_value=1)
    comp, _ = ndimage.label(mask, np.ones((3, 3)))  # 8 邻接，和寻路一致
    keep = set()
    _, (iy, ix) = ndimage.distance_transform_edt(comp == 0, return_indices=True)
    for x, y in seeds:  # 种子点落在不可走的地方时，接到最近的可走块
        keep.add(int(comp[iy[y, x], ix[y, x]]))
    mask = np.isin(comp, list(keep))
    mask = ndimage.binary_erosion(mask, np.ones((5, 5)), border_value=1)  # 脚离墙和水留一点距离；地图边缘不收，路可以走出画面
    # 角色从脚底往上画，贴着喷泉这类矮物件的前沿走会像踩进去：整块挖掉（椭圆：cx, cy, rx, ry）
    if fixes.get('block_ellipses'):
        yy, xx = np.mgrid[0:mask.shape[0], 0:mask.shape[1]]
        for cx, cy, rx, ry in fixes['block_ellipses']:
            mask &= ((xx - cx) / rx) ** 2 + ((yy - cy) / ry) ** 2 > 1
    H, W = mask.shape
    grid = mask[:H - H % CELL, :W - W % CELL].reshape(H // CELL, CELL, W // CELL, CELL).mean(axis=(1, 3)) > 0.5
    Image.fromarray((grid * 255).astype(np.uint8)).save(out)
    # 给服务端寻路用的网格：每行一串 0/1
    json.dump({'cell': CELL, 'w': int(grid.shape[1]), 'h': int(grid.shape[0]), 'rows': [''.join('1' if v else '0' for v in row) for row in grid]},
              open(out.rsplit('.', 1)[0] + '.json', 'w'))
    big = np.kron(grid, np.ones((CELL, CELL), bool))
    vis = im.astype(np.float32)
    vis[big] = vis[big] * 0.55 + np.array([60, 255, 120]) * 0.45
    vis[~big] = vis[~big] * 0.7
    v = Image.fromarray(vis.astype(np.uint8))
    d = ImageDraw.Draw(v)
    for x, y in seeds:
        d.ellipse([x - 9, y - 9, x + 9, y + 9], fill=(255, 0, 255), outline=(0, 0, 0), width=2)
    v.resize((W * 2 // 3, H * 2 // 3)).save(f'{work}/walk-preview.jpg', quality=85)
    print(out, grid.shape, f'walkable {grid.mean():.1%}', 'components kept', len(keep))


if __name__ == '__main__':
    cmd = sys.argv[1]
    if cmd == 'regions':
        regions(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == 'build':
        build(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5], [tuple(int(v) for v in s.split(',')) for s in sys.argv[6:]])
