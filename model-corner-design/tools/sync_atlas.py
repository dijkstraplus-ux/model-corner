"""Copy demo2/assets/atlas.json into the page's inline ATLAS, and register every extra action atlas
(<id>-act8b/c/d) that exists on disk in ASSET, so new sprite sheets show up without hand edits.

    python3 -I tools/sync_atlas.py
"""
import json, os, re, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PAGE, ASSETS = os.path.join(ROOT, 'demo2', 'index.html'), os.path.join(ROOT, 'demo2', 'assets')
atlas = json.load(open(os.path.join(ASSETS, 'atlas.json')))
s = open(PAGE, encoding='utf8').read()
# 1. 图集元数据：整行替换（HD 文件还没有的条目去掉 hd，页面会用普通图集）
for k, v in atlas.items():
    if 'hd' in v and not os.path.exists(os.path.join(ASSETS, f'{k}-hd.webp')):
        v.pop('hd')
s, n = re.subn(r'const ATLAS = /\*ATLAS\*/\{.*?\};\n', lambda m: 'const ATLAS = /*ATLAS*/' + json.dumps(atlas, ensure_ascii=False, separators=(',', ':')) + ';\n', s, count=1, flags=re.S)
if n != 1: sys.exit('ATLAS line not found')
# 2. ASSET：新的动作图集登记一次
extra = [k for k in atlas if re.fullmatch(r'(ds|claude|gpt)-act8[bcd]', k) and os.path.exists(os.path.join(ASSETS, f'{k}.webp'))]
line = '  /*EXTRA*/' + ', '.join(f"'{k}': 'assets/{k}.webp'" for k in extra) + ',\n'
if '/*EXTRA*/' in s: s = re.sub(r'  /\*EXTRA\*/.*\n', lambda m: line, s, count=1)
else: s = s.replace("  props: 'assets/props.webp',", line + "  props: 'assets/props.webp',", 1)
open(PAGE, 'w', encoding='utf8').write(s)
print('atlas entries:', len(atlas), '| extra action atlases:', ', '.join(extra) or '(none)')
