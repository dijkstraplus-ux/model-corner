# Inline the page's assets/* into one self-contained HTML (data URIs) so it opens anywhere.
import base64, pathlib, re, sys
src = pathlib.Path(sys.argv[1]); out = pathlib.Path(sys.argv[2])
html = src.read_text(encoding='utf-8')
def inline(m):
    path = src.parent / m.group(1)
    mime = {'.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2'}[path.suffix]
    return "'data:%s;base64,%s'" % (mime, base64.b64encode(path.read_bytes()).decode())
html, n = re.subn(r"'(assets/[\w.-]+\.(?:webp|png|woff2))(?:\?[\w=.-]*)?'", inline, html)  # 允许带 ?v= 版本号
out.write_text(html, encoding='utf-8')
print(out, n, 'assets inlined', out.stat().st_size // 1024, 'KB')
