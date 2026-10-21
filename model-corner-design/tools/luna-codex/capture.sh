#!/bin/bash
# capture.sh <extra codex args...> — 对着本地假 provider 发一次请求，打印请求里剩下的工具和上下文块
mkdir -p /tmp/luna-codex-cap /tmp/luna-codex-run; rm -f /tmp/luna-codex-cap/req_*; python3 -I /data/ws/model-corner-design/tools/luna-codex/cap_server.py & srv=$!; sleep 0.5
cd /tmp/luna-codex-run && OPENAI_API_KEY=x CODEX_HOME=/data/ws/.codex-luna timeout 60 codex exec --skip-git-repo-check --ephemeral --ignore-user-config --json -s read-only \
 -c model_provider=cap -c model_providers.cap.name=cap -c model_providers.cap.base_url=http://127.0.0.1:47999/v1 -c model_providers.cap.wire_api=responses -c model_providers.cap.env_key=OPENAI_API_KEY -c model_providers.cap.request_max_retries=0 -c model_providers.cap.stream_max_retries=0 \
 "$@" - < ${PROMPT:?set PROMPT=<file>} > /tmp/luna-codex-cap/out.jsonl 2>&1
kill $srv
python3 -I - <<'PY'
import json,glob
f=glob.glob('/tmp/luna-codex-cap/req_*')
if not f: print('NO REQUEST'); print(open('/tmp/luna-codex-cap/out.jsonl').read()[-800:]); raise SystemExit
d=json.load(open(f[0])); tot=0
for t in d.get('tools',[]): print('TOOL', t.get('name') or t.get('type'))
for it in d['input']:
    n=len(json.dumps(it,ensure_ascii=False)); tot+=n
    if it.get('type')=='additional_tools':
        def nm(ts): return [x.get('name') if not x.get('tools') else f"{x.get('name')}:{nm(x['tools'])}" for x in ts]
        print('ADDL_TOOLS', n, nm(it['tools'])); continue
    c=it.get('content') or []
    print('INPUT', it.get('role'), n, [x.get('text','')[:60].replace('\n',' ') for x in c])
print('total input chars', tot, 'instructions', len(d.get('instructions','')), 'reasoning', d.get('reasoning'))
PY
