"""One vision call through the relay (token read from /data/ws/mira_token, never printed).

    vlm_call.py <model> <prompt.txt> <out.json> <image> [image ...] [--max-tokens N]

Writes the raw response JSON to <out.json> and prints usage and the first part of the answer.
"""
import base64
import json
import re
import sys
import time
import urllib.error
import urllib.request

RELAY = 'https://relay.mirasim.ai/v1/chat/completions'


def token():
    return re.search(r'msk_[A-Za-z0-9_.-]+', open('/data/ws/mira_token').read()).group(0)


def main():
    args = sys.argv[1:]
    max_tokens = 16000
    if '--max-tokens' in args:
        i = args.index('--max-tokens')
        max_tokens = int(args[i + 1])
        del args[i:i + 2]
    model, prompt_file, out, *images = args
    content = [{'type': 'text', 'text': open(prompt_file, encoding='utf-8').read()}]
    for p in images:
        mime = 'image/png' if p.endswith('.png') else 'image/jpeg'
        content.append({'type': 'image_url', 'image_url': {'url': f'data:{mime};base64,' + base64.b64encode(open(p, 'rb').read()).decode()}})
    body = json.dumps({'model': model, 'max_tokens': max_tokens, 'messages': [{'role': 'user', 'content': content}]}).encode()
    req = urllib.request.Request(RELAY, body, {'Authorization': f'Bearer {token()}', 'Content-Type': 'application/json'})
    t = time.time()
    try:
        with urllib.request.urlopen(req, timeout=600) as r:
            data = json.loads(r.read())
    except urllib.error.HTTPError as e:
        print('HTTP', e.code, e.read()[:500].decode(errors='replace'))
        sys.exit(1)
    json.dump(data, open(out, 'w'), ensure_ascii=False)
    u = data.get('usage', {})
    msg = data['choices'][0]['message'].get('content') or ''
    print(f'{time.time() - t:.0f}s', {k: u.get(k) for k in ('prompt_tokens', 'completion_tokens', 'cost')}, data['choices'][0].get('finish_reason'), len(msg))
    print(msg[:1200])


if __name__ == '__main__':
    main()
