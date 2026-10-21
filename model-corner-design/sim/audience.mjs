// 观众席：给开发团队的留言。只有 server.mjs 引用这里，模拟世界（sim.mjs、提示词、漫画、日报）读不到任何访客数据。
import { createPublicKey, randomBytes, verify } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const DATA = process.env.SIM_DATA || fileURLToPath(new URL('./data/', import.meta.url));
const DIR = `${DATA}audience/`, LETTERS = `${DIR}letters.jsonl`, REPLIES = `${DIR}replies.json`;
const PUB = '/data/ws/.mirasim/publish/';
export const KINDS = ['建议', '想看的剧情', '问题反馈', '其他'];

// 经 mirasim 边缘进来的请求带平台签名的访客断言；本机预览（Vite 代理）没有
let key = null;
function visitorOf(req) {
  const raw = String(req.headers['x-mirasim-visitor'] ?? ''), dot = raw.lastIndexOf('.');
  if (dot <= 0) return null;
  try {
    const payload = raw.slice(0, dot), c = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!key || (c.kid && c.kid !== key.kid)) key = JSON.parse(readFileSync(`${PUB}visitor-key.json`, 'utf8'));
    const pub = createPublicKey({ key: Buffer.from(key.spki, 'base64url'), format: 'der', type: 'spki' });
    if (c.typ !== 'publish-visitor' || !verify(null, Buffer.from(payload), pub, Buffer.from(raw.slice(dot + 1), 'base64url'))) return null;
    if (c.exp && c.exp * 1000 < Date.now()) return null;
    return { sub: c.sub, name: c.name || null };
  } catch { return null; }
}

const all = () => (existsSync(LETTERS) ? readFileSync(LETTERS, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const replies = () => (existsSync(REPLIES) ? JSON.parse(readFileSync(REPLIES, 'utf8')) : {});

// 限流：同一个人 10 分钟 3 封、一天 10 封
const recent = new Map();
function limited(who) {
  const now = Date.now(), xs = (recent.get(who) || []).filter((t) => now - t < 86400000);
  recent.set(who, xs);
  return xs.filter((t) => now - t < 600000).length >= 3 || xs.length >= 10;
}

export function postLetter(req, body) {
  const text = String(body.text ?? '').trim(), token = String(body.token ?? '');
  if (!/^[a-z0-9]{16,40}$/.test(token)) return [400, { error: '缺少留言凭证' }];
  if (text.length < 2 || text.length > 500) return [400, { error: '留言要在 2～500 字之间' }];
  const v = visitorOf(req), who = v?.sub || `t:${token}`;
  if (limited(who)) return [429, { error: '留言太频繁了，晚点再写吧' }];
  recent.get(who).push(Date.now());
  mkdirSync(DIR, { recursive: true });
  const letter = { id: `L${Date.now().toString(36)}${randomBytes(2).toString('hex')}`, at: Date.now(), token, kind: KINDS.includes(body.kind) ? body.kind : '其他', text, visitor: v?.sub || null, name: v?.name || null, via: v ? 'member' : 'preview' };
  appendFileSync(LETTERS, JSON.stringify(letter) + '\n');
  console.log(`[sim] new letter ${letter.id} (${letter.kind}, ${letter.via})`);
  return [200, { ok: true, letter: view(letter, {}) }];
}

const view = (l, r) => ({ id: l.id, at: l.at, kind: l.kind, text: l.text, reply: r[l.id] || null });
export function myLetters(token) {
  if (!/^[a-z0-9]{16,40}$/.test(token || '')) return [];
  const r = replies();
  return all().filter((l) => l.token === token).slice(-30).reverse().map((l) => view(l, r));
}

// 给开发团队用（命令行）：列出、回复
export function listLetters() { const r = replies(); return all().map((l) => ({ ...l, token: undefined, reply: r[l.id] || null })); }
export function replyLetter(id, text) {
  if (!all().some((l) => l.id === id)) throw new Error(`no letter ${id}`);
  const r = replies(); r[id] = { text: String(text).slice(0, 500), at: Date.now() };
  mkdirSync(DIR, { recursive: true });
  writeFileSync(`${REPLIES}.tmp`, JSON.stringify(r)); renameSync(`${REPLIES}.tmp`, REPLIES);
}
