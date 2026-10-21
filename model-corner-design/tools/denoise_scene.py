"""Remove gpt-image noise from a scene image with a gpt-image-2 edit, keeping content and positions unchanged.

    denoise_scene.py <in.webp|png> <out.png> <prompt.txt>

Prints usage and the measured shift between input and output (must stay well under 1 px before the result is used).
"""
import base64, io, json, re, sys, time, urllib.error, urllib.request
import numpy as np
from PIL import Image
from skimage.registration import phase_cross_correlation

src, out, pfile = sys.argv[1:4]
im = Image.open(src).convert('RGB')
buf = io.BytesIO(); im.save(buf, 'PNG')
tok = re.search(r'msk_[A-Za-z0-9_.-]+', open('/data/ws/mira_token').read()).group(0)
body = {'model': 'gpt-image-2', 'prompt': open(pfile).read(), 'images': [{'image_url': 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode()}],
        'size': f'{im.width}x{im.height}', 'quality': 'high', 'input_fidelity': 'high', 'n': 1}
req = urllib.request.Request('https://relay.mirasim.ai/v1/images/edits', json.dumps(body).encode(), {'Authorization': f'Bearer {tok}', 'Content-Type': 'application/json'})
t = time.time()
try:
    d = json.loads(urllib.request.urlopen(req, timeout=600).read())
except urllib.error.HTTPError as e:
    sys.exit(f'HTTP {e.code} {e.read()[:300].decode(errors="replace")}')
res = Image.open(io.BytesIO(base64.b64decode(d['data'][0]['b64_json']))).convert('RGB')
if res.size != im.size:
    res = res.resize(im.size, Image.LANCZOS)
res.save(out)
a, b = np.asarray(im.convert('L'), float), np.asarray(res.convert('L'), float)
sh = phase_cross_correlation(a, b, upsample_factor=4)[0]
print(json.dumps({'file': src, 'seconds': round(time.time() - t), 'tokens': d.get('usage', {}).get('total_tokens'), 'shift': [round(float(v), 2) for v in sh]}))
