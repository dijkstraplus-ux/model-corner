"""Semantic segmentation of a town map with SegFormer-B5 (ADE20K, ONNX), run locally on CPU.

    segment_map.py <model_dir> <map.webp> <out_prefix>

Writes <out_prefix>.npz (per-class probabilities at 1/2 resolution, float16) and <out_prefix>-classes.jpg
(argmax colored, with a legend of the largest classes). The model dir holds config.json + onnx/model.onnx
(Xenova/segformer-b5-finetuned-ade-640-640); it is only read, nothing in it is executed.
"""
import json
import sys

import numpy as np
import onnxruntime as ort
from PIL import Image, ImageDraw

TILE, STRIDE = 640, 448
MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)


def softmax(x, axis=0):
    x = x - x.max(axis=axis, keepdims=True)
    e = np.exp(x)
    return e / e.sum(axis=axis, keepdims=True)


def tiles(n, size):
    out = list(range(0, max(n - size, 0) + 1, STRIDE))
    if out[-1] + size < n:
        out.append(n - size)
    return out


def run(model_dir, path, scale):
    labels = json.load(open(f'{model_dir}/config.json'))['id2label']
    sess = ort.InferenceSession(f'{model_dir}/onnx/model.onnx', providers=['CPUExecutionProvider'])
    name = sess.get_inputs()[0].name
    im = Image.open(path).convert('RGB')
    W, H = im.size
    w, h = round(W * scale), round(H * scale)
    arr = (np.asarray(im.resize((w, h), Image.BICUBIC), np.float32) / 255 - MEAN) / STD
    pw, ph = max(w, TILE), max(h, TILE)
    pad = np.zeros((ph, pw, 3), np.float32)
    pad[:h, :w] = arr
    acc = np.zeros((150, ph // 4, pw // 4), np.float32)
    wsum = np.zeros((ph // 4, pw // 4), np.float32)
    # 每块中心权重高、边缘低，拼接处不会出现硬接缝
    r = np.hanning(TILE // 4 + 2)[1:-1]
    win = np.outer(r, r).astype(np.float32) + 1e-3
    for y in tiles(ph, TILE):
        for x in tiles(pw, TILE):
            t = pad[y:y + TILE, x:x + TILE].transpose(2, 0, 1)[None]
            logits = sess.run(None, {name: t})[0][0]  # (150, 160, 160)
            acc[:, y // 4:(y + TILE) // 4, x // 4:(x + TILE) // 4] += softmax(logits) * win
            wsum[y // 4:(y + TILE) // 4, x // 4:(x + TILE) // 4] += win
    prob = acc / wsum
    prob = prob[:, :h // 4, :w // 4]
    return labels, prob


def main():
    model_dir, path, out = sys.argv[1:4]
    W, H = Image.open(path).size
    gw, gh = W // 2, H // 2
    total = np.zeros((150, gh, gw), np.float32)
    for scale in (1.0, 0.75):  # 两个尺度取平均：近看细节、远看结构
        labels, p = run(model_dir, path, scale)
        t = np.stack([np.asarray(Image.fromarray(c).resize((gw, gh), Image.BILINEAR)) for c in p])
        total += t
    total /= 2
    np.savez_compressed(f'{out}.npz', prob=total.astype(np.float16))
    cls = total.argmax(0)
    counts = np.bincount(cls.ravel(), minlength=150)
    top = [int(i) for i in np.argsort(-counts)[:16] if counts[i] > 0]
    rng = np.random.default_rng(7)
    pal = rng.integers(40, 255, (150, 3)).astype(np.uint8)
    vis = pal[cls]
    base = np.asarray(Image.open(path).convert('RGB').resize((gw, gh)), np.float32)
    mix = Image.fromarray((base * 0.35 + vis * 0.65).astype(np.uint8))
    d = ImageDraw.Draw(mix)
    for k, i in enumerate(top):
        y = 6 + k * 16
        d.rectangle([6, y, 20, y + 12], fill=tuple(int(v) for v in pal[i]), outline=(0, 0, 0))
        d.text((26, y), f'{labels[str(i)]} {counts[i] / cls.size:.1%}', fill=(255, 255, 255), stroke_width=2, stroke_fill=(0, 0, 0))
    mix.save(f'{out}-classes.jpg', quality=85)
    print(out, [(labels[str(i)], round(counts[i] / cls.size, 3)) for i in top])


if __name__ == '__main__':
    main()
