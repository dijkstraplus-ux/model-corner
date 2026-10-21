// 模拟服务：只监听本机端口，只回答 /api/*；页面通过 Vite 的 /api 代理来访问
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { chronicle, snapshot, start, stop, stateVer } from './sim.mjs';
import { i18nVersion, i18nStatus, localizeCached } from './i18n.mjs';
import { myLetters, postLetter } from './audience.mjs';
import { loadPapers } from './paper.mjs';
import { COMIC_DIR, loadComics } from './comic.mjs';

const PORT = +(process.env.SIM_PORT || 5174);
const viewers = new Map();
// 对外发布（成员版）时由这个服务直接给页面：只给 demo2 这一个目录里的文件
const SITE = fileURLToPath(new URL('../demo2/', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' };
async function serveStatic(url, res) {
  const rel = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
  const file = resolve(SITE, '.' + rel);
  if (!file.startsWith(SITE) || rel.split('/').some((p) => p.startsWith('.')) || !MIME[extname(file)]) return false;
  try {
    const data = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)], 'Cache-Control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(data);
    return true;
  } catch { return false; }
}

function send(req, res, code, body) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' };
  let data = body === undefined ? '' : JSON.stringify(body);
  if (data.length > 2048 && /\bgzip\b/.test(req.headers['accept-encoding'] || '')) { data = gzipSync(data); headers['Content-Encoding'] = 'gzip'; }
  res.writeHead(code, headers);
  res.end(data);
}

const server = createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  // 唯一能写的接口：给开发团队留言（不进模拟世界）
  if (req.method === 'POST' && url.pathname === '/api/letters') {
    let body = '', big = false;
    req.on('data', (d) => { body += d; if (body.length > 4096) { big = true; req.destroy(); } });
    req.on('end', () => {
      if (big) return;
      let j; try { j = JSON.parse(body); } catch { return send(req, res, 400, { error: 'bad json' }); }
      const [code, out] = postLetter(req, j); send(req, res, code, out);
    });
    return;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return send(req, res, 405, { error: 'method not allowed' });
  if (url.pathname === '/api/letters') return send(req, res, 200, { letters: myLetters(url.searchParams.get('token')) });
  // ?lang=en|ja：世界里的中文换成译文（还没翻好的保持中文，后台会去翻）；默认 zh
  const lang = ['en', 'ja'].includes(url.searchParams.get('lang')) ? url.searchParams.get('lang') : 'zh';
  if (url.pathname === '/api/chronicle') {
    const days = chronicle();
    return send(req, res, 200, lang === 'zh' ? { days, lang } : { ...localizeCached(`chronicle.${stateVer()}`, { days }, lang), lang });
  }
  if (url.pathname === '/api/health') return send(req, res, 200, { ok: true });
  if (url.pathname === '/api/i18n') return send(req, res, 200, i18nStatus());
  if (url.pathname === '/api/state') {
    // 在线人数：每个页面带一个随机编号，30 秒内拉过就算在看
    const cid = url.searchParams.get('c'), now = Date.now();
    if (cid && cid.length <= 16) viewers.set(cid, now);
    for (const [k, t] of viewers) if (now - t > 30000) viewers.delete(k);
    const snap = snapshot();
    snap.viewers = viewers.size;
    snap.comics = loadComics().filter((c) => c.kind !== 'none').slice(-30).map(({ id, kind, at, day, span, title, file }) => ({ id, kind, at, day, span, title, url: `/api/comics/${file}` }));
    snap.papers = loadPapers().map(({ day, headline }) => ({ day, headline }));
    snap.ver = `${snap.ver}.${snap.comics.length}.${snap.papers.length}`;
    if (lang !== 'zh') snap.ver += `.i${i18nVersion()}`; // 新翻好的句子也算一次更新
    if (url.searchParams.get('v') === String(snap.ver)) { res.writeHead(204, { 'Cache-Control': 'no-store' }); return res.end(); }
    snap.lang = lang;
    if (lang === 'zh') return send(req, res, 200, snap);
    const { now: at, viewers: n, ...rest } = snap; // 在线人数、服务器时间每次都是新的，其余按版本缓存
    return send(req, res, 200, { now: at, viewers: n, ...localizeCached(`state.${snap.ver}`, rest, lang) });
  }
  // 漫画 / CG 图片：只认 c<数字>.png
  const cm = url.pathname.match(/^\/api\/comics\/(c\d+\.png)$/);
  if (cm) return readFile(COMIC_DIR + cm[1]).then((d) => { res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400' }); res.end(d); }, () => send(req, res, 404, { error: 'not found' }));
  if (!url.pathname.startsWith('/api/')) return serveStatic(url, res).then((ok) => { if (!ok) send(req, res, 404, { error: 'not found' }); }, () => send(req, res, 404, { error: 'not found' }));
  send(req, res, 404, { error: 'not found' });
});

// 重启时旧进程可能还没放开端口：等一会儿再试
let tries = 0;
server.on('error', (e) => {
  if (e.code === 'EADDRINUSE' && tries++ < 30) { setTimeout(() => server.listen(PORT, '127.0.0.1'), 1000); return; }
  console.error('[sim] server error', e);
  process.exit(1);
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`[sim] listening on 127.0.0.1:${PORT}`);
  start();
});

const quit = () => { stop(); server.close(); process.exit(0); };
process.on('SIGTERM', quit);
process.on('SIGINT', quit);
process.on('uncaughtException', (e) => console.error('[sim] uncaught', e));
process.on('unhandledRejection', (e) => console.error('[sim] unhandled', e));
