// 多语言：世界内部一直用中文（提示词、状态、所有逻辑都不变），只在接口输出时把中文换成英文 / 日文。
// 译文放在一张以中文原文为键的表里（data/i18n.json）：
//   exact：中文原文 → [en, ja, 最后用到的日子]（模型自己给的三语输出用 learn() 记进来）
//   tmpl ：把数字换成 {0}{1}… 的「数字模板」→ [en, ja, 日子]（系统拼出来的句子，比如「柜台上还有 4 个饭团」）
// 没有译文的句子原样返回中文，同时排进后台翻译队列（只有真有人用 en/ja 看时才会排队，没人看就零花费）。
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chat, parseJson, CreditExhausted } from './llm.mjs';
import { claudeChat } from './claude.mjs';
import { codexChat } from './codex.mjs';

const DATA = process.env.SIM_DATA || fileURLToPath(new URL('./data/', import.meta.url));
const FILE = `${DATA}i18n.json`, CALLS = `${DATA}calls.jsonl`;
const CONFIG = fileURLToPath(new URL('./config.json', import.meta.url));
export const LANGS = ['en', 'ja'];
const LI = { en: 0, ja: 1 };
const CJK = /[㐀-鿿豈-﫿]/;
const NUM = /\d+(?:[.:：]\d+)*/g;
const KEEP_DAYS = 14, MAX_LEN = 1500;
const today = () => Math.floor(Date.now() / 86400000);

// ---------- 词表（手写的专有名词） ----------
const GLOSS = new Map();
try {
  const g = JSON.parse(readFileSync(fileURLToPath(new URL('./content/glossary.json', import.meta.url)), 'utf8'));
  for (const [sec, entries] of Object.entries(g)) {
    if (sec.startsWith('_') || typeof entries !== 'object') continue;
    for (const [zh, t] of Object.entries(entries)) if (t?.en && t?.ja) GLOSS.set(zh, [t.en, t.ja]);
  }
} catch (e) { console.error('[i18n] glossary', e.message); }
const GLOSS_KEYS = [...GLOSS.keys()].sort((a, b) => b.length - a.length);
// 给模型看的精简译名表：区域、店名、小镇
const CORE = ['鲸巷', '鲸巷广场', '海边集市', '后山公园', '深海食堂', '纸页书屋', '星仪万事屋', '鲸巷日报', '服务器繁忙', '鱼片们', '雨天的书签', '海苔饭团', '灯笼节', '流星雨', '集市日', '读书会', '渔夫老海', '花摊婆婆', '邮差小鸥'];
export const glossaryLine = () => CORE.filter((k) => GLOSS.has(k)).map((k) => `${k}=${GLOSS.get(k)[0]}/${GLOSS.get(k)[1]}`).join('；');
// 一段文字里出现了哪些词表里的词（给翻译用，保证译名一致）
export function glossaryFor(text, max = 40) {
  const out = [];
  for (const k of GLOSS_KEYS) { if (text.includes(k)) out.push([k, ...GLOSS.get(k)]); if (out.length >= max) break; }
  return out;
}

// ---------- 译文表 ----------
let store = { exact: {}, tmpl: {} }, version = 1, saveTimer = null;
try { if (existsSync(FILE)) { const j = JSON.parse(readFileSync(FILE, 'utf8')); store = { exact: j.exact || {}, tmpl: j.tmpl || {} }; } } catch (e) { console.error('[i18n] load', e.message); }
export const i18nVersion = () => version;

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const cut = today() - KEEP_DAYS;
    for (const m of [store.exact, store.tmpl]) for (const [k, v] of Object.entries(m)) if ((v[2] || 0) < cut) delete m[k];
    try { mkdirSync(DATA, { recursive: true }); writeFileSync(`${FILE}.tmp`, JSON.stringify(store)); renameSync(`${FILE}.tmp`, FILE); } catch (e) { console.error('[i18n] save', e.message); }
  }, 5000);
}
const touch = (v) => { const d = today(); if (v[2] !== d) { v[2] = d; save(); } };
// 「柜台上还有 4 个饭团」→ 键「柜台上还有 {0} 个饭团」和数字 ['4']
function template(zh) {
  const nums = [];
  const key = zh.replace(NUM, (m) => `{${nums.push(m) - 1}}`);
  return { key, nums };
}
const holes = (s) => (String(s).match(/\{\d+\}/g) || []).sort().join(',');
const clean = (s) => (typeof s === 'string' ? s.trim() : '');

// 模型给的三语输出：记下来（en / ja 可以缺一个）
export function learn(zh, en, ja) {
  zh = clean(zh); en = clean(en); ja = clean(ja);
  if (!zh || !CJK.test(zh) || (!en && !ja) || GLOSS.has(zh)) return;
  if (ja && !/[぀-ヿ㐀-鿿]/.test(ja)) ja = ''; // 日文栏里不是日文
  if (en && CJK.test(en)) en = ''; // 英文栏里夹着中文
  if (!en && !ja) return;
  const old = store.exact[zh];
  store.exact[zh] = [en || old?.[0] || null, ja || old?.[1] || null, today()];
  version++; save();
}

// 查一句的译文；没有就返回 null
export function lookup(zh, lang) {
  const i = LI[lang];
  if (i === undefined) return zh;
  const g = GLOSS.get(zh); if (g) return g[i];
  const e = store.exact[zh];
  if (e?.[i]) { touch(e); return e[i]; }
  const { key, nums } = template(zh);
  if (nums.length) {
    const t = store.tmpl[key];
    if (t?.[i]) { touch(t); return t[i].replace(/\{(\d+)\}/g, (_, n) => nums[+n] ?? ''); }
  }
  return null;
}

// ---------- 接口输出 ----------
// 深拷贝，把含中文的字符串换成译文。键名不动；名叫 state 的子树不动（页面拿那里的中文做判断），
// 改为在顶层的 tr 里给出 { 中文: 译文 }。没有译文的保持中文，并排进翻译队列。
export function localize(obj, lang) {
  if (LI[lang] === undefined) return obj;
  const tr = {};
  const str = (s) => {
    if (!CJK.test(s)) return s;
    const t = lookup(s, lang);
    if (t == null) { want(s); return s; }
    return t;
  };
  const walk = (x, inState) => {
    if (typeof x === 'string') {
      if (!inState) return str(x);
      if (CJK.test(x) && !(x in tr)) { const t = lookup(x, lang); if (t == null) want(x); else tr[x] = t; }
      return x;
    }
    if (Array.isArray(x)) return x.map((v) => walk(v, inState));
    if (x && typeof x === 'object') {
      const o = {};
      for (const [k, v] of Object.entries(x)) o[k] = walk(v, inState || k === 'state');
      return o;
    }
    return x;
  };
  const out = walk(obj, false);
  if (out && typeof out === 'object' && !Array.isArray(out)) out.tr = tr;
  kick();
  return out;
}
// 同一份数据（同一个版本、同一个语言）只翻一次：很多人同时在看也不重复做
const cache = new Map();
export function localizeCached(key, obj, lang) {
  const k = `${key}|${version}|${lang}`;
  if (cache.has(k)) return cache.get(k);
  const out = localize(obj, lang);
  cache.set(k, out);
  while (cache.size > 8) cache.delete(cache.keys().next().value);
  return out;
}

// ---------- 后台翻译 ----------
const queue = new Map(); // 键（数字模板或原文）→ { key, tmpl, at }
const noTmpl = new Set(), gaveUp = new Map(); // 模板译坏了的改按整句翻；翻了几次都不成的，6 小时内不再排队
let inFlight = false, timer = null, fails = 0, backoffUntil = 0, lastCall = 0, stopped = false, hour = { h: '', n: 0 };
const MIN_GAP = 4000, BATCH_N = 40, BATCH_CHARS = 4000;
function cfg() {
  try { return { enabled: true, model: 'claude:claude-haiku-5-5', maxCallsPerHour: 60, ...(JSON.parse(readFileSync(CONFIG, 'utf8')).i18n || {}) }; } catch { return { enabled: false }; }
}
function want(zh) {
  if (zh.length > MAX_LEN) return;
  const { key, nums } = template(zh), tmpl = nums.length > 0 && key !== zh && !noTmpl.has(key);
  const k = tmpl ? key : zh;
  if ((gaveUp.get(k) || 0) > Date.now()) return;
  const q = queue.get(k);
  if (q) { q.at = Date.now(); return; }
  if (queue.size > 5000) return;
  queue.set(k, { key: k, tmpl, at: Date.now(), tries: 0 });
}
function kick(delay = 300) {
  if (timer || inFlight || !queue.size || stopped || process.env.SIM_I18N === 'off') return;
  const wait = Math.max(delay, backoffUntil - Date.now(), lastCall + MIN_GAP - Date.now());
  timer = setTimeout(() => { timer = null; pump().catch((e) => console.error('[i18n] pump', e)); }, wait);
  timer.unref?.();
}
function logCall(entry) {
  try { if (existsSync(CALLS) && statSync(CALLS).size > 30e6) renameSync(CALLS, `${CALLS}.1`); } catch { /* ignore */ }
  try { appendFileSync(CALLS, JSON.stringify(entry) + '\n'); } catch { /* ignore */ }
}
const SYSTEM = (gloss) => `You translate short texts from a cozy slice-of-life game set in 鲸巷 (Whale Lane), a little seaside neighbourhood. The texts are in Simplified Chinese: diary entries, thoughts, small talk, town news lines, shop signs, place names.
Translate each item into natural English ("en") and natural Japanese ("ja").
- Three residents, all girls: DeepSeek (a whale girl who runs 深海食堂 Deep Sea Diner), Claude (runs 纸页书屋 Paper Leaf Books), GPT (a white dragon who runs 星仪万事屋 Starglass Odd Jobs). Never translate or change the names DeepSeek, Claude, GPT. Use she/her.
- English: warm, cozy, simple; contractions are fine. Japanese: reads like a gentle Japanese slice-of-life game (speech in casual 口語, narration in plain だ/である or です/ます matching the original tone).
- Keep first person in diaries and thoughts. Keep it about as short as the original; no explanations, no notes, no romanization.
- Quotes: Chinese 「…」 → English “…”, Japanese 「…」. Book/story/star-chart titles 《…》 → English “…” (no italics, no asterisks), Japanese 『…』.
- Placeholders like {0} {1} stand for numbers or times: keep every one of them exactly once in both translations.
- Every item must be translated, even single words.
${gloss.length ? `Fixed names (always use these):\n${gloss.map(([zh, en, ja]) => `${zh} = ${en} / ${ja}`).join('\n')}\n` : ''}Input is JSON {"items":[{"id":n,"zh":"..."}]}. Output ONLY JSON {"items":[{"id":n,"en":"...","ja":"..."}]} with every id.`;
async function call(model, messages) {
  const [via, rest] = model.includes(':') ? [model.split(':')[0], model.slice(model.indexOf(':') + 1)] : [null, model];
  if (via === 'claude') return claudeChat({ model: rest, messages, timeoutMs: 180000, rp: false });
  if (via === 'codex') return codexChat({ model: rest, messages, timeoutMs: 180000, rp: false });
  return chat({ model, messages, maxTokens: 8000, temperature: 0.3, json: true, timeoutMs: 120000 });
}
async function pump() {
  const c = cfg();
  if (!c.enabled || stopped || inFlight || !queue.size) return;
  const h = new Date().toISOString().slice(0, 13);
  if (hour.h !== h) hour = { h, n: 0 };
  if (hour.n >= (c.maxCallsPerHour || 60)) { backoffUntil = Date.now() + 60000; return kick(); }
  // 最近被要过的先翻
  const items = [];
  let chars = 0;
  for (const q of [...queue.values()].sort((a, b) => b.at - a.at)) {
    if (items.length >= BATCH_N || (items.length && chars + q.key.length > BATCH_CHARS)) break;
    items.push(q); chars += q.key.length;
  }
  inFlight = true; hour.n++; lastCall = Date.now();
  const input = { items: items.map((q, i) => ({ id: i + 1, zh: q.key })) };
  const text = items.map((q) => q.key).join('\n'), gloss = glossaryFor(text);
  // 引号、书名号里已经有译文的（模型自己给过的书名、漫画名、说过的话），也当固定译名，前后一致
  for (const m of text.matchAll(/[《「]([^》」\n]{1,60})[》」]/g)) {
    const e = store.exact[m[1]];
    if (e?.[0] && e?.[1] && !gloss.some((g) => g[0] === m[1]) && gloss.length < 60) gloss.push([m[1], e[0], e[1]]);
  }
  const messages = [{ role: 'system', content: SYSTEM(gloss) }, { role: 'user', content: JSON.stringify(input) }];
  const t0 = Date.now();
  try {
    const r = await call(c.model, messages);
    logCall({ at: new Date(t0).toISOString(), char: 'town', kind: 'translate', model: c.model, ms: r.ms, usage: r.usage, messages, reply: r.text });
    const out = parseJson(r.text).items || [];
    let got = 0;
    for (const [i, q] of items.entries()) {
      const o = out.find((x) => +x.id === i + 1);
      const en = clean(o?.en), ja = clean(o?.ja);
      if (!en || !ja) { if (++q.tries >= 3) { queue.delete(q.key); gaveUp.set(q.key, Date.now() + 6 * 3600e3); } continue; }
      if (q.tmpl) {
        const want = holes(q.key);
        if (holes(en) !== want || holes(ja) !== want) { queue.delete(q.key); noTmpl.add(q.key); continue; } // 占位符对不上：下次被要到时按原文整句翻
        store.tmpl[q.key] = [en, ja, today()];
      } else store.exact[q.key] = [store.exact[q.key]?.[0] || en, store.exact[q.key]?.[1] || ja, today()];
      queue.delete(q.key); got++;
    }
    if (got) { version++; save(); }
    fails = 0;
  } catch (e) {
    logCall({ at: new Date(t0).toISOString(), char: 'town', kind: 'translate', model: c.model, messages, error: String(e.message || e) });
    if (e instanceof CreditExhausted) { stopped = true; console.error('[i18n] relay credit exhausted — translator stopped until restart'); }
    else { fails++; backoffUntil = Date.now() + Math.min(1800, 30 * 2 ** fails) * 1000; console.error('[i18n] translate failed:', String(e.message || e).slice(0, 200)); }
    for (const q of items) if (++q.tries >= 4) { queue.delete(q.key); gaveUp.set(q.key, Date.now() + 6 * 3600e3); }
  } finally {
    inFlight = false;
    kick(MIN_GAP);
  }
}
export const i18nStatus = () => ({ version, queued: queue.size, exact: Object.keys(store.exact).length, tmpl: Object.keys(store.tmpl).length, inFlight, stopped, backoffUntil, hourCalls: hour.n });
