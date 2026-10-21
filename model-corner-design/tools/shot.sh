#!/bin/sh
# usage: shot.sh <url-or-file> <out.png> [width] [height]
url="$1"; out="$2"; w="${3:-1400}"; h="${4:-1200}"
case "$url" in http*|file*) ;; *) url="file://$(readlink -f "$url")";; esac
google-chrome --headless=new --no-sandbox --disable-gpu --hide-scrollbars --allow-file-access-from-files \
  --force-device-scale-factor=1 --window-size="$w,$h" --virtual-time-budget=1500 --screenshot="$out" "$url" 2>/dev/null
ls -la "$out"
