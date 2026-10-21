#!/bin/bash
# usage: gen_image.sh <prompt.txt> <out-prefix> [size] [quality]
# Calls the relay's gpt-image-2. The token is read from /data/ws/mira_token and never printed; the auth header
# goes to curl through a file descriptor, so it does not show up in `ps` while a call is running.
set -euo pipefail
prompt_file="$1"; out="$2"; size="${3:-1024x1024}"; quality="${4:-high}"
TOKEN=$(grep -o 'msk_[A-Za-z0-9_.-]*' /data/ws/mira_token | head -1)
payload=$(jq -n --rawfile p "$prompt_file" --arg s "$size" --arg q "$quality" '{model:"gpt-image-2", prompt:$p, size:$s, quality:$q, n:1}')
start=$(date +%s)
code=$(curl -sS -o "$out.json" -w '%{http_code}' --max-time 600 https://relay.mirasim.ai/v1/images/generations \
  -H @<(printf 'Authorization: Bearer %s\n' "$TOKEN") -H 'content-type: application/json' -d "$payload")
echo "http=$code seconds=$(( $(date +%s) - start ))"
if [ "$code" != 200 ]; then head -c 600 "$out.json"; echo; exit 1; fi
jq -r '.data[0].b64_json' "$out.json" | base64 -d > "$out.png"
jq -c '{usage, size: .size, quality: .quality, revised: (.data[0].revised_prompt // null | if . then .[0:80] else null end)}' "$out.json"
jq 'del(.data[0].b64_json)' "$out.json" > "$out.meta.json" && rm -f "$out.json"
python3 -I -c "import struct,sys; d=open(sys.argv[1],'rb').read(32); print('png', struct.unpack('>II', d[16:24]))" "$out.png"
