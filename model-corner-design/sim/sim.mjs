// 模拟：时钟、角色的时间线、决策循环（模型决定做什么，系统负责走路和时间）、记忆、日记、街区日志
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AREAS, ACTIVITIES, ANIM, PLACES, SHOPS, TRAVEL_SEC, route } from './world.mjs';
import { findPath, nearestWalkable, pathLength, center } from './nav.mjs';
import { CHARS } from './personas.mjs';
import { chat, parseJson, CreditExhausted } from './llm.mjs';
import { codexChat, closeCodex } from './codex.mjs';
import { claudeChat } from './claude.mjs';
import { makeComic, loadComics } from './comic.mjs';
import { makePaper, loadPapers } from './paper.mjs';
import { initWorld, migrateWorld, worldClock, startVerb, settleVerb, noteText, worldLines, worldSnapshot, weatherName, THINGS, getter, ctxFor } from './worldstate.mjs';
import { calendarTick, incidentTick, activeEvents, todayEvents } from './events.mjs';
import { projectOptions, projectStep, projectLines, projectSnapshot, clean as projClean } from './projects.mjs';
import { learn, glossaryLine } from './i18n.mjs';
import { buildMenu } from './menu.mjs';
import { initSocial, invText, give, askFor, answerRequest, finishRequest, invite, calendar, myGatherings, gatheringAct, gatheringDoing, gatheringAnim, gatheringName, betweenLines, topics, addJoke, addPromise, addShared, eatFromBag, bagFood, bond, pairKey, socialTick, inviteIdeas, ITEMS, itemName, takeParcel, newUid, similar } from './social.mjs';

const POSES = JSON.parse(readFileSync(fileURLToPath(new URL('./content/poses.json', import.meta.url)), 'utf8'));
const DATA = process.env.SIM_DATA || fileURLToPath(new URL('./data/', import.meta.url)); // 测试时可以换一个数据目录
const STATE = `${DATA}state.json`, CALLS = `${DATA}calls.jsonl`, ARCHIVE = `${DATA}log-archive.jsonl`;
const CONFIG = fileURLToPath(new URL('./config.json', import.meta.url));

export const SPEED = 8; // 游戏时间倍速
const FAST = +(process.env.SIM_FAST || 1); // 只给测试用：时钟和活动时长一起压缩
const WALK = 40, ACC = 0.45; // 走路：地图像素/现实秒；起步停步缓动（和客户端一致）
const LEAD = 12; // 当前活动结束前多少现实秒开始想下一件事
const IDS = Object.keys(CHARS);

let S, cfg, timer, saveTimer;
const pad = (n) => String(n).padStart(2, '0');
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const rnd = (a, b) => a + Math.random() * (b - a);
const pick = (xs) => xs[Math.floor(Math.random() * xs.length)];
// 模型偶尔把输出格式里的字段名写进话里（「answer说好要……」），换回中文
const FIELD_WORDS = [[/\banswer(?:ed|s)?\b/gi, '答应'], [/\bpromise[sd]?\b/gi, '答应'], [/\boption\b/gi, '选项']];
const cut = (s, n) => (typeof s === 'string' ? FIELD_WORDS.reduce((t, [re, w]) => t.replace(re, w), s).trim().slice(0, n) : '');
// 模型同时给出的英文 / 日文版本（"en": {...}, "ja": {...}）：中文定稿之后，把对应的译文记进译文表（接口给 en/ja 页面时用）。
// pairs: [[中文定稿, 字段名或取值函数, 中文长度上限]]；英文最长约 2.5 倍，日文约 1.3 倍
const QUOTES = /^[「《“"『』」》”\s]+|[「《“"『』」》”\s]+$/g;
function learnTr(raw, pairs) {
  const en = raw && typeof raw.en === 'object' ? raw.en : null, ja = raw && typeof raw.ja === 'object' ? raw.ja : null;
  if (!en && !ja) return;
  const get = (o, f) => (typeof f === 'function' ? f(o || {}) : o?.[f]);
  const tidy = (t, zh, n) => { if (typeof t !== 'string') return ''; t = t.trim(); if (!/^[「《“"『]/.test(zh)) t = t.replace(QUOTES, ''); return t.slice(0, n); };
  for (const [zh, f, n] of pairs) if (zh) try { learn(zh, tidy(get(en, f), zh, Math.ceil(n * 2.5)), tidy(get(ja, f), zh, Math.ceil(n * 1.3))); } catch { /* 译文坏了不影响世界 */ }
}
const triOut = (fields) => ` "en": {${fields.map(([k, d]) => `"${k}": "${d || k}的英文版"`).join(', ')}},
 "ja": {${fields.map(([k, d]) => `"${k}": "${d || k}的日文版"`).join(', ')}}`;

// ---------- 时间 ----------
export const gameMin = (ms) => S.clock.base + (ms - S.clock.epoch) / 60000 * SPEED * FAST;
const realMs = (gameMinutes) => gameMinutes / SPEED * 60000 / FAST;
const hm = (m) => `${pad(Math.floor(m / 60) % 24)}:${pad(Math.floor(m % 60))}`;
const dayOf = (m) => Math.floor(m / 1440);
const hourOf = (m) => (m % 1440) / 60;
function period(h) {
  if (h < 5) return '深夜'; if (h < 8) return '清晨'; if (h < 11) return '上午'; if (h < 13) return '中午';
  if (h < 17) return '下午'; if (h < 19) return '傍晚'; if (h < 22) return '晚上'; return '深夜';
}

// ---------- 状态 ----------
function freshState() {
  const now = Date.now();
  const [hh, mm] = (process.env.SIM_START || '07:00').split(':').map(Number); // 测试时可以从别的时间开始
  const day = +(process.env.SIM_DAY || 1); // 测试时也可以从别的日子开始（第 6 天是周六）
  const st = { clock: { epoch: now, base: day * 1440 + hh * 60 + mm }, seq: 0, ver: 1, chars: {}, log: [], usage: {}, llm: { status: 'ok' } };
  for (const [id, c] of Object.entries(CHARS)) {
    const home = PLACES[c.home];
    st.chars[id] = {
      stats: { ...c.stats },
      plan: [{ id: ++st.seq, kind: 'act', area: home.area, inside: c.home, x: home.stand[0], y: home.stand[1], place: c.home, activity: 'rest', anim: 'idle', icon: 'sparkle', doing: '刚起床', says: [], t0: now, t1: now + rnd(4000, 20000) }],
      thoughts: [], diary: [], today: [], inbox: [],
      memories: c.memories.map(([imp, text]) => ({ text, imp, day: 0, at: now })),
      rel: Object.fromEntries(Object.entries(c.rel).map(([k, [v, label]]) => [k, { v, label }])),
    };
  }
  S = st; st.world = initSocial(initWorld(gameMin(now)));
  return st;
}

function load() {
  mkdirSync(DATA, { recursive: true });
  S = existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : freshState();
  S.llm = { status: S.llm?.status === 'credit' ? 'credit' : 'ok' };
  // 去掉早期的 PDF 设定：记忆、念头、聊天记录里提到的都清掉，印象标签换回人设里的
  for (const [id, c] of Object.entries(S.chars)) {
    const bad = (x) => /PDF/i.test(x.text || '');
    c.memories = c.memories.filter((m) => !bad(m)); c.thoughts = c.thoughts.filter((t) => !bad(t));
    c.today = c.today.filter((t) => !bad(t)); c.inbox = c.inbox.filter((t) => !bad(t));
    for (const g of c.plan) { if (/PDF/i.test(g.thought || '')) g.thought = ''; g.says = (g.says || []).filter((x) => !/PDF/i.test(x.text)); }
    for (const [k, r] of Object.entries(c.rel)) if (/PDF/i.test(r.label) && CHARS[id].rel[k]) r.label = CHARS[id].rel[k][1];
  }
  S.log = S.log.filter((e) => !/PDF/i.test(e.text));
  // 小镇改名叫「鲸巷」：旧名字统一换掉
  const rename = (t) => (typeof t === 'string' ? t.replace(/模型街角/g, '鲸巷').replace(/街角广场/g, '鲸巷广场').replace(/街角日报/g, '鲸巷日报') : t);
  for (const c of Object.values(S.chars)) {
    for (const k of ['memories', 'thoughts', 'diary', 'today', 'inbox']) for (const x of c[k] || []) x.text = rename(x.text);
    for (const r of Object.values(c.rel)) r.label = rename(r.label);
    for (const g of c.plan) { g.doing = rename(g.doing); g.thought = rename(g.thought); }
  }
  for (const e of S.log) e.text = rename(e.text);
  // 访客不再影响世界：去掉「访客送的」「访客留言」这类记忆
  for (const c of Object.values(S.chars)) for (const m of c.memories) {
    m.text = m.text.replace('，海苔是鱼片们送的', '').replace('第一次有访客为我的诗留言', '第一次有人在书屋门口停下来读完了我的诗');
  }
  S.world = initSocial(S.world ? migrateWorld(S.world, gameMin(Date.now())) : initWorld(gameMin(Date.now())));
  const shelf = S.world.things.shelf; if (shelf && /[：:《》]/.test(shelf.rec || '')) shelf.rec = shelf.rec.replace(/^.*?[：:]\s*|[《》「」"]/g, ''); // 早先写进去的「今日推荐：《……》」
  cfg = JSON.parse(readFileSync(CONFIG, 'utf8'));
  if (process.env.SIM_LLM === 'off') cfg.enabled = false; // 不调用模型，只按习惯过日子
}

export function save(now = false) {
  S.ver++;
  clearTimeout(saveTimer);
  const write = () => { writeFileSync(`${STATE}.tmp`, JSON.stringify(S)); renameSync(`${STATE}.tmp`, STATE); };
  if (now) write(); else saveTimer = setTimeout(write, 800);
}

function addLog(who, area, text, at, star = false, extra = null) {
  const m = gameMin(at);
  // 90 游戏分钟内同一件事不记两遍（一字不差，或者同一个人说的几乎是同一件事：比如模型写的日志和系统记的约饭）
  if (S.log.slice(-30).some((e) => m - (e.day * 1440 + +e.t.slice(0, 2) * 60 + +e.t.slice(3)) < 90 && (e.text === text || (e.who === who && who !== 'town' && similar(e.text, text) >= 0.7)))) return;
  S.log.push({ id: ++S.seq, who, area, text, star, at, day: dayOf(m), t: hm(m), ...(extra || {}) });
  if (S.log.length > 600) appendFileSync(ARCHIVE, S.log.splice(0, S.log.length - 600).map((e) => JSON.stringify(e)).join('\n') + '\n');
}
function dayLog(day) {
  const old = existsSync(ARCHIVE) ? readFileSync(ARCHIVE, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  return [...old, ...S.log].filter((e) => e.day === day);
}
// 一天的材料：日志、三人的日记、念头、画好的漫画
function dayBundle(day) {
  const diaries = {}, thoughts = [];
  for (const [id, c] of Object.entries(S.chars)) {
    const d = c.diary.find((x) => x.day === day);
    if (d) diaries[id] = { mood: d.mood, text: d.text };
    thoughts.push(...c.thoughts.filter((x) => x.day === day).map((x) => ({ ...x, who: id })));
  }
  const log = dayLog(day);
  const comics = loadComics().filter((c) => c.kind !== 'none' && c.day === day);
  return { day, log, diaries, thoughts: thoughts.sort((a, b) => a.at - b.at).filter((_, i, a) => i % Math.ceil(a.length / 18 || 1) === 0), comics };
}
// 日志的分类（不依赖中文，给 en/ja 页面用）：换区域的是 kind 'move'，漫画画好的带 comic 编号；早先没记的按文字补上
const comicTitles = () => new Map(loadComics().filter((c) => c.kind !== 'none').map((c) => [c.title, c.id]));
function logTags(e, ids) {
  if (e.kind || e.comic) return e;
  if (/去了(鲸巷广场|海边集市|后山公园)$/.test(e.text)) return { ...e, kind: 'move' };
  const m = e.who === 'town' && /画好了/.test(e.text) && e.text.match(/《(.+)》/);
  if (m && ids.has(m[1])) return { ...e, comic: ids.get(m[1]) };
  return e;
}
// 编年史：每一天的日报、日记、要事和漫画
const NOISE = /起床了|去了|睡觉了|写完了第/;
export function chronicle() {
  const papers = loadPapers(), today = dayOf(gameMin(Date.now())), comicIds = comicTitles();
  const days = new Set([...S.log.map((e) => e.day), ...Object.values(S.chars).flatMap((c) => c.diary.map((d) => d.day))]);
  return [...days].filter((d) => d >= 1 && d <= today).sort((a, b) => b - a).map((day) => {
    const b = dayBundle(day);
    return {
      day, today: day === today,
      paper: papers.find((p) => p.day === day) || null,
      diaries: b.diaries,
      events: b.log.filter((e) => !NOISE.test(e.text)).slice(-24).map((e) => logTags(e, comicIds)).map(({ t, who, text, star, area, kind, comic }) => ({ t, who, text, star, area, kind, comic })),
      comics: b.comics.map(({ id, kind, title, span, file }) => ({ id, kind, title, span, url: `/api/comics/${file}` })),
    };
  });
}

function episode(e, gm = gameMin(Date.now())) {
  const W = S.world;
  W.episodes.push({ id: `e${++W.seq}`, at: Date.now(), day: dayOf(gm), t: hm(gm), title: e.title, who: e.who || [], lines: e.lines || [], w: e.w || 1, drawn: false });
  if (W.episodes.length > 200) W.episodes.splice(0, W.episodes.length - 200);
}
// 关系分随事件小幅变化：送东西、借东西 +1，帮了忙 +2，一起参加聚会 +1，没做到答应的事 −2；每对每天最多 ±6
function relBump(a, b, d) {
  const r = S.chars[a]?.rel?.[b]; if (!r) return;
  const day = dayOf(gameMin(Date.now())), k = `${a}|${b}`;
  if (S.relDay?.day !== day) S.relDay = { day, n: {} };
  const used = S.relDay.n[k] || 0, real = clamp(used + d, -6, 6) - used;
  if (!real) return;
  S.relDay.n[k] = used + real; r.v = clamp(r.v + real, 0, 100);
}
const socialHooks = { log: (who, text, star) => addLog(who, posAt(S.chars[who] || S.chars.ds, Date.now()).area || 'square', text, Date.now(), star), episode: (e) => episode(e), rel: relBump };

// 记忆去重：和最近 20 条比较「两个字一组」的重合度，太像就不记
function bigrams(t) { const s = new Set(); for (let i = 0; i < t.length - 1; i++) s.add(t.slice(i, i + 2)); return s; }
function remember(c, mem) {
  const b = bigrams(mem.text);
  if (!b.size) return;
  const dup = c.memories.slice(-20).some((m) => { const o = bigrams(m.text); let k = 0; for (const x of b) if (o.has(x)) k++; return k / Math.min(b.size, o.size || 1) >= 0.5; });
  if (!dup) c.memories.push(mem);
  if (c.memories.length > 200) c.memories.splice(0, c.memories.length - 200);
}

// ---------- 位置 ----------
const planEnd = (c) => (c.plan.length ? c.plan[c.plan.length - 1].t1 : Date.now());
const lastAct = (c) => [...c.plan].reverse().find((s) => s.kind === 'act');

// 时间线结束时人在哪
function endPos(c) {
  const s = c.plan[c.plan.length - 1];
  if (s.kind === 'walk') return { area: s.area, x: s.pts.at(-1)[0], y: s.pts.at(-1)[1] };
  if (s.kind === 'travel') return { area: s.to, x: s.entry[0], y: s.entry[1] };
  return { area: s.area, inside: s.inside, x: s.x, y: s.y, place: s.place };
}

// 某一时刻人在哪、在做什么（服务端只要大概位置，用匀速插值）
function posAt(c, ms) {
  const s = c.plan.find((x) => x.t0 <= ms && ms < x.t1) || c.plan[c.plan.length - 1];
  if (s.kind === 'travel') return { seg: s, travel: true, area: null };
  if (s.kind === 'walk') {
    const L = pathLength(s.pts), d = L * clamp((ms - s.t0) / (s.t1 - s.t0), 0, 1);
    let acc = 0;
    for (let i = 1; i < s.pts.length; i++) {
      const a = s.pts[i - 1], b = s.pts[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
      if (acc + l >= d) { const u = l ? (d - acc) / l : 0; return { seg: s, area: s.area, x: a[0] + (b[0] - a[0]) * u, y: a[1] + (b[1] - a[1]) * u }; }
      acc += l;
    }
    return { seg: s, area: s.area, x: s.pts.at(-1)[0], y: s.pts.at(-1)[1] };
  }
  return { seg: s, area: s.area, inside: s.inside, x: s.x, y: s.y, place: s.place };
}

function whereText(p) {
  if (p.travel) return `在去${AREAS[p.seg.to].name}的路上`;
  if (p.inside) return `${SHOPS[p.inside].name}（店里）`;
  if (p.place && PLACES[p.place]) return PLACES[p.place].name;
  return AREAS[p.area].name;
}

// 站位：别和别人站在同一个点上
function standAt(area, at, selfId) {
  const g = AREAS[area].grid;
  const taken = (x, y) => IDS.some((id) => id !== selfId && (() => { const e = endPos(S.chars[id]); return e.area === area && !e.inside && Math.hypot(e.x - x, e.y - y) < 36; })());
  for (const [ox, oy] of [[0, 0], [48, 0], [-48, 0], [0, 36], [0, -36], [56, 30], [-56, 30], [56, -30], [-56, -30]]) {
    const c = nearestWalkable(g, at[0] + ox, at[1] + oy);
    if (!c) continue;
    const [x, y] = center(g, c);
    if (Math.hypot(x - at[0] - ox, y - at[1] - oy) < 20 && !taken(x, y)) return [x, y];
  }
  return at;
}

// ---------- 规划路线：从时间线末尾走到目标 ----------
function planRoute(id, c, target, t) {
  // target: { area, inside?, at: [x, y] }
  const segs = [];
  let pos = endPos(c);
  if (pos.inside && pos.inside === target.inside) return { segs, t };
  if (pos.inside) pos = { area: pos.area, x: SHOPS[pos.inside].stand[0], y: SHOPS[pos.inside].stand[1] };
  const fly = (area, from, to, doing) => { // 飞：直线，不看能不能走
    const L = Math.hypot(to[0] - from[0], to[1] - from[1]); if (L < 4) return;
    const T = (L / WALK + ACC) * 1000;
    segs.push({ id: ++S.seq, kind: 'walk', fly: true, area, pts: [from, to], doing, icon: 'walk', says: [], t0: t, t1: t + T });
    t += T;
  };
  const back = lastAct(c)?.flyBack;
  if (back && !pos.inside && !(target.fly && target.fly[0] === pos.x && target.fly[1] === pos.y)) { fly(pos.area, [pos.x, pos.y], back, '飞回岸边'); pos = { area: pos.area, x: back[0], y: back[1] }; }
  const hops = route(pos.area, target.area) || [];
  const walk = (area, from, to, doing) => {
    const pts = findPath(AREAS[area].grid, from, to) || [from, to];
    const L = pathLength(pts);
    if (L < 4) return;
    const T = (L / WALK + ACC) * 1000;
    segs.push({ id: ++S.seq, kind: 'walk', area, pts, doing, icon: 'walk', says: [], t0: t, t1: t + T });
    t += T;
  };
  const dest = target.inside ? SHOPS[target.inside].name : (target.label || AREAS[target.area].name);
  for (const h of hops) {
    walk(h.from, [pos.x, pos.y], h.exit, `往${AREAS[h.to].name}走`);
    segs.push({ id: ++S.seq, kind: 'travel', from: h.from, to: h.to, entry: h.entry, doing: `在去${AREAS[h.to].name}的路上`, icon: 'walk', says: [], t0: t, t1: t + TRAVEL_SEC * 1000 });
    t += TRAVEL_SEC * 1000;
    pos = { area: h.to, x: h.entry[0], y: h.entry[1] };
  }
  if (!(target.fly && pos.area === target.area && pos.x === target.fly[0] && pos.y === target.fly[1])) {
    walk(target.area, [pos.x, pos.y], target.at, `去${dest}`);
    if (target.fly) fly(target.area, target.at, target.fly, `飞上${target.flyName || dest}`);
  }
  return { segs, t };
}

// ---------- 数值：每个游戏小时的变化 ----------
const RATE = {
  work: { energy: -2, mood: 1 }, eat: { mood: 3 }, read: { mood: 3 }, write: { mood: 2 }, slack: { energy: 3, mood: 2 },
  rest: { energy: 5, mood: 2 }, chat: { mood: 6 }, play: { mood: 6, energy: -2 }, stargaze: { mood: 4 }, shop: { mood: 3 },
  errand: { energy: -3, mood: 2 }, pray: { mood: 3 }, sleep: { energy: 11, mood: 1 },
};
function applyStats(c, seg) {
  if (seg.applied || seg.kind !== 'act') return;
  seg.applied = true;
  const h = (seg.t1 - seg.t0) / 60000 * SPEED * FAST / 60, r = RATE[seg.activity] || {}, s = c.stats;
  s.food += (seg.activity === 'sleep' ? -1.5 : -4) * h + (seg.activity === 'eat' ? 45 : 0);
  s.energy += (seg.activity === 'sleep' ? 0 : -3) * h + (r.energy || 0) * h;
  s.mood += (r.mood || 0) * h + (65 - s.mood) * 0.04 * h + (s.food < 25 ? -3 * h : 0);
  for (const k of ['food', 'energy', 'mood']) s[k] = Math.round(clamp(s[k], 0, 100));
}

// ---------- 模型调用 ----------
function usageBucket(now) {
  const d = new Date(now).toISOString().slice(0, 10), hKey = new Date(now).toISOString().slice(0, 13);
  if (S.usage.date !== d) S.usage = { date: d, calls: 0, prompt: 0, completion: 0, cost: 0, hours: {} };
  S.usage.hours[hKey] = S.usage.hours[hKey] || 0;
  return hKey;
}
function logCall(entry) {
  try { if (existsSync(CALLS) && statSync(CALLS).size > 30e6) renameSync(CALLS, `${CALLS}.1`); } catch { /* ignore */ }
  appendFileSync(CALLS, JSON.stringify(entry) + '\n');
}
// 「codex:模型名」「claude:模型名」走 mirasim 自己的 codex / claude 通道（不花中转站额度），出错只让那一个通道退避
const VIA = { codex: codexChat, claude: claudeChat }, viaBackoff = {}, viaFails = {};
async function llm(id, kind, messages, maxTokens) {
  const now = Date.now();
  const model = cfg.models[id] || cfg.model, via = VIA[model.split(':')[0]] ? model.split(':')[0] : null;
  if (!cfg.enabled || (!via && S.llm.status === 'credit')) return null;
  if (via ? (viaBackoff[via] || 0) > now : (S.llm.backoffUntil || 0) > now) return null;
  const hKey = usageBucket(now);
  if (S.usage.calls >= cfg.maxCallsPerDay || S.usage.hours[hKey] >= cfg.maxCallsPerHour) { S.llm.status = 'budget'; return null; }
  S.usage.calls++; S.usage.hours[hKey]++;
  if (via) {
    try {
      const r = await VIA[via]({ model: model.slice(via.length + 1), messages });
      logCall({ at: new Date(now).toISOString(), char: id, kind, model, ms: r.ms, usage: r.usage, messages, reply: r.text });
      viaFails[via] = 0;
      return parseJson(r.text);
    } catch (e) {
      logCall({ at: new Date(now).toISOString(), char: id, kind, model, messages, error: String(e.message || e) });
      viaFails[via] = (viaFails[via] || 0) + 1; viaBackoff[via] = now + Math.min(600, 15 * 2 ** viaFails[via]) * 1000;
      console.error(`[sim] ${id} ${kind} via ${via} failed:`, String(e.message || e).slice(0, 200));
      return null;
    }
  }
  try {
    const r = await chat({ model, messages, maxTokens, temperature: cfg.temperature ?? 0.9, reasoning: cfg.reasoning, json: true });
    S.usage.prompt += r.usage.prompt_tokens || 0; S.usage.completion += r.usage.completion_tokens || 0; S.usage.cost += r.usage.cost || 0;
    logCall({ at: new Date(now).toISOString(), char: id, kind, model, ms: r.ms, usage: r.usage, messages, reply: r.text });
    S.llm = { status: 'ok', fails: 0 };
    return parseJson(r.text);
  } catch (e) {
    logCall({ at: new Date(now).toISOString(), char: id, kind, model, messages, error: String(e.message || e) });
    if (e instanceof CreditExhausted) {
      S.llm = { status: 'credit', error: '中转站额度用完了' };
      console.error('[sim] relay credit exhausted — LLM calls stopped until restart');
    } else {
      const fails = (S.llm.fails || 0) + 1;
      S.llm = { status: 'error', error: String(e.message || e).slice(0, 160), fails, backoffUntil: e.retryable ? now + Math.min(600, 15 * 2 ** fails) * 1000 : now + 30000 };
      console.error(`[sim] ${id} ${kind} failed:`, String(e.message || e).slice(0, 200));
    }
    return null;
  }
}

// ---------- 提示词 ----------
function placeList() {
  return Object.keys(AREAS).map((a) => `${AREAS[a].name}：${Object.entries(PLACES).filter(([, p]) => p.area === a).map(([k, p]) => `${k}${p.name.replace(/^(广场|集市|后山|公园)的?/, '')}`).join(' ')}`).join('\n');
}
function systemPrompt(id, out) {
  return `${CHARS[id].persona}

【世界】你住在「鲸巷」——海边小镇里的一个小街区，有三个区域：鲸巷广场（深海食堂、纸页书屋、星仪万事屋都在这里）、海边集市、后山公园。这里的时间比现实快 8 倍；大家按正常的生活节奏过日子：白天开店、吃饭、散步、和朋友聊天，晚上回自己店里睡觉。常有访客在围观你们的生活。
【地点】（id + 名字；每个地方现在是什么样、能做什么，看「现在能做的」）
${placeList()}
【活动】${Object.entries(ACTIVITIES).map(([k, a]) => `${k}=${a.desc}`).join('；')}
【规则】你是这里的居民，不是 AI 助手，不要提到模型、提示词、JSON。街区的居民都是女孩子（用「她」称呼）。说话和想法都要符合你的性格，用中文。
你有自己的店和自己的事要忙；聊天是生活的一部分，但不要每件事都去找人聊，和同一个人聊过之后隔一两个小时再找她。一件事做完就放下，别一整天围着同一件事打转；同一个忙别反复求同一个人。
优先从「现在能做的」里选一个 option；清单里没有你想做的事，才自己写 place 和 activity。世界里的东西会记住你做过什么（锅会煮好、沙堡会被潮水冲掉、黑板上的字会留着）。
${out}
【三语】你用中文思考和说话，中文字段照常写。小镇也有说英语、日语的观众：先把中文字段一个不落地写好（格式里列出的每个字段都要有），再在 "en"、"ja" 里把同样的内容写成自然的英文和日文（意思一致、保留你的语气；中文字段是空字符串的，对应的也留空字符串）。固定译名：${glossaryLine()}；名字 DeepSeek、Claude、GPT 不翻译。`;
}
const DECIDE_OUT = `【输出】一次只决定接下来的一件事。只输出一个 JSON 对象：
{"thought": "此刻的内心独白，第一人称，1～2 句（≤50字）",
 "option": "从「现在能做的」里选的编号，如 o2；不从清单里选就写空字符串",
 "place": "地点 id（option 为空时才填）",
 "activity": "活动 id（option 为空时才填）",
 "write": "这件事要写下文字时（黑板、告示、许愿牌、推荐的书名）写的内容，否则空字符串",
 "doing": "别人看到你在做什么（≤12字，如：在长椅上看书）",
 "minutes": 这件事持续的游戏分钟数（20～150 的整数）,
 "say": "说出口的一句话（≤20字），不说就写空字符串",
 "talk_to": "想搭话的人的 id（ds、claude、gpt），不搭话就写空字符串",
 "give": "把随身的东西交给身边的人，如 claude:饭团（借书、还东西也用它），没有就空字符串",
 "ask": "请身边的人帮个忙，如 claude:帮我理账本，没有就空字符串",
 "invite": "约人一起做事，如 claude,gpt:meal@19:00（meal 一起吃饭 / reading 读书会 / stargaze 观星 / build 堆沙堡），没有就空字符串",
 "log": "只有对街区来说值得一提的事（新菜、新书、帮了谁、有趣的意外）才写一句街区日志：用名字开头、第三人称、≤30字；日常琐事写空字符串",
 "remember": "值得长期记住的事（≤30字），没有就空字符串",
 "importance": 1到3的整数（remember 的重要程度）,
${triOut([['thought'], ['doing'], ['say'], ['write'], ['ask', 'ask 里冒号后面那件事'], ['log'], ['remember']])}}`;

function memLines(c) {
  const ms = [...c.memories].sort((a, b) => b.imp - a.imp || b.at - a.at).slice(0, 6);
  const recent = [...c.memories].sort((a, b) => b.at - a.at).slice(0, 3).filter((m) => !ms.includes(m));
  return [...ms, ...recent].map((m) => `- ${'★'.repeat(m.imp)} ${m.text}`).join('\n') || '（暂无）';
}
function relLine(id, c) {
  return Object.entries(c.rel).map(([k, r]) => `${CHARS[k].name}（${r.v}）${r.label}`).join('；');
}
function situation(id, c, t, menu) {
  const now = Date.now(), m = gameMin(t), p = endPos(c), last = lastAct(c);
  const lastMin = last ? Math.round((last.t1 - last.t0) / 60000 * SPEED) : 0;
  const others = IDS.filter((x) => x !== id).map((x) => {
    const o = S.chars[x], q = posAt(o, now), seg = q.seg;
    const same = !q.travel && q.area === p.area ? (q.inside && q.inside === p.inside ? '（和你在同一家店里）' : '（和你在同一个区域）') : '';
    const sleeping = seg.activity === 'sleep' ? '，在睡觉' : '';
    const talked = c.lastTalk?.[x] !== undefined ? `；你们上次说话是 ${Math.round(gameMin(t) - c.lastTalk[x])} 分钟前` : '';
    return `- ${CHARS[x].name}（${x}）：${whereText(q)}，${seg.doing}${sleeping}${same}${talked}`;
  }).join('\n');
  const inbox = c.inbox.map((x) => `- ${x.t} ${x.text}`).join('\n');
  const events = S.log.filter((e) => e.at <= now && !/去了|起床了|睡觉了|写完了第/.test(e.text)).slice(-5).map((e) => `- ${e.t} ${e.text}`).join('\n') || '（还没有）';
  const counts = {};
  for (const x of c.today) { const k = x.doing || (x.with ? `和${CHARS[x.with].name}聊天` : null); if (k) counts[k] = (counts[k] || 0) + 1; }
  const today = c.today.length ? `${Object.entries(counts).map(([k, n]) => (n > 1 ? `${k} ${n} 次` : k)).slice(-8).join('、')}；最近：${c.today.slice(-3).map((x) => `${x.t} ${x.doing ? x.text.split('，说')[0] : x.with ? `和${CHARS[x.with].name}聊天` : x.text}`).join('；')}` : '（刚开始新的一天）';
  const W = S.world, wx = W.weather, wd = '一二三四五六日'[((dayOf(m) - 1) % 7 + 7) % 7];
  const evs = todayEvents(m), on = activeEvents(m);
  const wxLine = `${weatherName(wx.today)}${wx.today === 'rain' ? `（${wx.rain[0]}点到${wx.rain[1]}点下雨）` : ''}${evs.length ? ` · 今天有${evs.map((e) => `${e.name}${e.until ? `（${e.at}–${e.until}）` : ''}`).join('、')}` : ''}${on.length ? `（${on.map((e) => e.name).join('、')}正在进行）` : ''}`;
  const todo = (W.todo[id] || []).filter((x) => x.day === dayOf(m)).map((x) => `- 昨晚想好的：${x.text}`);
  const mine = (W.things.cboard?.list || []).filter((x) => x.status === 'open').length && id === 'gpt' ? [`- 委托板上有 ${(W.things.cboard.list || []).filter((x) => x.status === 'open').length} 张没人接的委托`] : [];
  for (const x of myGatherings(W, id, m)) mine.push(`- ${hm(x.at)} ${x.host === id ? '你约了' + x.invited.map((k) => CHARS[k].name).join('、') : CHARS[x.host].name + '约了你'}：${gatheringName(x)}（${PLACES[x.place].name}）`);
  for (const r of W.requests.filter((r) => r.status === 'accepted')) {
    if (r.to === id) mine.push(`- 你答应帮${CHARS[r.from].name}：${r.text}`);
    if (r.from === id) mine.push(`- 你请${CHARS[r.to].name}帮忙：${r.text}（她答应了）`);
  }
  mine.push(...projectLines(W, id));
  const bag = invText(W, id); if (bag.length) mine.push(`- 随身带着：${bag.join('、')}`);
  for (const it of (W.inv[id] || []).filter((x) => x.k === 'parcel' && x.to)) mine.push(`- 你帮${CHARS[it.to].name}取了包裹，见到她就用 give 交给她`);
  const near = IDS.filter((x) => x !== id).filter((x) => { const q = posAt(S.chars[x], now); return !q.travel && q.area === p.area; });
  const between = near.flatMap((x) => betweenLines(W, id, x, m).map((l) => `- ${l}`));
  const hints = [];
  const inv = W.inv[id] || [], gift = inv.find((it) => !ITEMS[it.k]?.unique && it.k !== 'parcel'), borrowed = inv.find((it) => ITEMS[it.k]?.unique && it.owner !== id), parcel = inv.find((it) => it.k === 'parcel' && near.includes(it.to));
  if (parcel) hints.push(`寄给${CHARS[parcel.to].name}的包裹在你手上，她就在附近，用 give 交给她（${parcel.to}:包裹）`);
  if (borrowed && near.includes(borrowed.owner)) hints.push(`${CHARS[borrowed.owner].name}借给你的${itemName(borrowed)}还在你这儿，她就在附近，想还的话用 give`);
  else if (gift && near.length) hints.push(`你带着${itemName(gift)}，${CHARS[near[0]].name}就在附近，想送的话用 give`);
  const hint = hints.length ? `\n（${hints.join('；')}）` : '';
  const thoughts = c.thoughts.slice(-3).map((x) => `- ${x.t} ${x.text}`).join('\n') || '（暂无）';
  const lateHint = hourOf(m) >= 22 || hourOf(m) < 5 ? '\n（已经很晚了，该考虑回自己店里睡觉了。）' : '';
  return `现在是第 ${dayOf(m)} 天 周${wd} ${hm(m)}（${period(hourOf(m))}）· ${wxLine}。${lateHint}
你在：${p.inside ? `${SHOPS[p.inside].name}（店里）` : p.place && PLACES[p.place] ? PLACES[p.place].name : AREAS[p.area].name}。刚才：${last ? `${last.doing}（${lastMin} 分钟）` : '刚醒'}。
你的状态：饱腹 ${c.stats.food}，精力 ${c.stats.energy}，心情 ${c.stats.mood}（满分 100，低于 30 就该处理了）。
其他人：
${others}
${inbox ? `刚才的对话：\n${inbox}\n` : ''}世界此刻：
${worldLines(W, m, id, p.area).join('\n')}
${todo.length || mine.length ? `你的事：\n${[...todo, ...mine].join('\n')}\n` : ''}${between.length ? `你们之间：\n${between.join('\n')}\n` : ''}现在能做的（option）：
${menu.map((o) => o.line).join('\n')}
街上最近的事：
${events}
你今天做过：${today}
你最近的念头：
${thoughts}
你记得的事：
${memLines(c)}
你对别人的印象：${relLine(id, c)}${hint}
接下来做什么？`;
}

// ---------- 兜底：没有模型时按习惯过日子 ----------
const HABITS = {
  ds: [['diner', 'work', '在店里煮饭'], ['benchW', 'slack', '在长椅上摸鱼'], ['fountain', 'rest', '在喷泉边发呆'], ['fruit', 'shop', '试吃橘子'], ['sandcastle', 'play', '堆沙堡']],
  claude: [['bookstore', 'work', '在书屋整理书架'], ['bookstore', 'write', '在书屋写诗'], ['benchE', 'read', '在长椅上看书'], ['tree', 'read', '在古树下看书'], ['flower', 'shop', '挑一束花']],
  gpt: [['observatory', 'work', '在店里整理委托'], ['post', 'errand', '在驿站接委托'], ['jetty', 'errand', '帮渔夫搬货'], ['pier', 'stargaze', '在栈桥看海'], ['swing', 'play', '荡秋千']],
};
function fallbackDecision(id, c, menu) {
  const o = menu?.find((x) => x.kind !== 'talk' && !x.writes);
  if (o) return { option: o.key, doing: o.label.slice(0, 12), minutes: Math.round(((o.minutes?.[0] || 30) + (o.minutes?.[1] || 60)) / 2) };
  if (c.stats.food < 35) return { place: 'diner', activity: 'eat', doing: '在深海食堂吃饭', minutes: 40 };
  const [place, activity, doing] = pick(HABITS[id]);
  return { place, activity, doing, minutes: Math.round(rnd(30, 90)) };
}

// ---------- 决策 ----------
function validate(id, c, d, menu = []) {
  const home = CHARS[id].home;
  const o = menu.find((x) => x.key === String(d.option || '').trim().toLowerCase());
  if (o) {
    if (o.kind === 'talk') { d.talk_to = o.talk; d.activity = 'chat'; d.place = o.place || d.place; if (o.invite && !d.invite) d.invite = o.invite; }
    else { d.place = o.place; d.activity = o.act; }
    if (o.minutes) d.minutes = clamp(Math.round(Number(d.minutes) || (o.minutes[0] + o.minutes[1]) / 2), o.minutes[0], Math.max(o.minutes[1], o.minutes[0]));
  }
  let place = PLACES[d.place] ? d.place : null;
  if (!place) place = Object.keys(PLACES).find((k) => typeof d.place === 'string' && PLACES[k].name.includes(d.place)) || null;
  let activity = ACTIVITIES[d.activity] ? d.activity : null;
  if (activity === 'sleep') place = home;
  if (!place) place = endPos(c).place && PLACES[endPos(c).place] ? endPos(c).place : home;
  const acts = PLACES[place].acts.filter((a) => (a !== 'work' && a !== 'sleep') || place === home);
  if (!acts.includes(activity)) activity = acts.includes('rest') ? 'rest' : acts[0];
  const minutes = clamp(Math.round(Number(d.minutes) || 45), activity === 'chat' ? 10 : 20, 150);
  const talk = IDS.includes(d.talk_to) && d.talk_to !== id ? d.talk_to : '';
  return {
    place, activity, minutes, talk,
    doing: cut(d.doing, 16) || (o && o.kind !== 'talk' ? cut(String(o.label || '').replace(/（.*$/, ''), 16) : '') || ACTIVITIES[activity].desc.split('、')[0], // 模型漏写 doing 时用选项的名字
    thought: cut(d.thought, 90), say: cut(d.say, 30), log: cut(d.log, 40), remember: cut(d.remember, 40),
    importance: clamp(Math.round(Number(d.importance) || 1), 1, 3),
    thing: o?.kind === 'thing' ? o.thing : null, verb: o?.kind === 'thing' ? o.verb : null, cid: o?.kind === 'commission' ? o.cid : null,
    gid: o?.kind === 'gathering' ? o.gid : null, rid: o?.kind === 'request' ? o.rid : null, bag: o?.kind === 'bag', proj: o?.kind === 'project' ? o.proj : null,
    give: cut(d.give, 30), ask: cut(d.ask, 40), invite: cut(d.invite, 40),
    // 要写书名的地方只留书名（模型常写成「今日推荐：《……》」）
    write: o?.writes ? cut(String(d.write || '').replace(/PDF|模型|AI/gi, '').replace(o.thing && THINGS[o.thing]?.verbs?.[o.verb]?.title ? /^.*?[：:]\s*|[《》「」"]/g : /$^/, ''), o.writes) : '', optKey: o ? (o.thing ? `${o.thing}.${o.verb}` : o.cid ? `c.${o.cid}` : o.proj ? `p.${o.proj}` : `${o.place}.${o.act}`) : `${place}.${activity}`,
  };
}

// 「现在能做的」：别人正在用的物件也算上（槽位）
function menuFor(id, c, t) {
  const now = Date.now(), pos = endPos(c);
  const others = IDS.filter((x) => x !== id).map((x) => {
    const q = posAt(S.chars[x], now), e = endPos(S.chars[x]), last = lastAct(S.chars[x]);
    return { id: x, travel: q.travel, asleep: q.seg.activity === 'sleep', place: e.place || (e.inside ? Object.keys(PLACES).find((k) => PLACES[k].inside === e.inside) : null), where: whereText(q), doing: q.seg.doing, thing: last && last.t1 > now ? last.thing : null };
  });
  // 手上这件事还没结算（还没做完）时，同一个动作不再出现在选项里
  const cur = lastAct(c), busyKey = cur && !cur.settled && (cur.thing || cur.cid) ? (cur.thing ? `${cur.thing}.${cur.verb}` : `c.${cur.cid}`) : null;
  const W = S.world, gm = gameMin(t), extras = [];
  let hostDue = null;
  for (const x of myGatherings(W, id, gm)) {
    const soon = x.at - gm, far = PLACES[x.place].area !== pos.area ? 75 : 20; // 跨区域要走一个多小时（游戏时间）
    if (soon > 150 || x.until - gm < far) continue; // 还早，或者赶过去就结束了
    const o = { kind: 'gathering', gid: x.gid, place: x.place, act: gatheringAct(x, id), label: `${x.host === id ? '主持' : '赴约'}：${gatheringName(x)}（${hm(x.at)}${x.host !== id ? `，${CHARS[x.host].name}约的` : ''}）`, minutes: [x.until - x.at, x.until - x.at], w: soon < 60 ? 8 : 3 };
    extras.push(o);
    if (x.host === id && soon < far + 30) hostDue = o; // 自己约的事快到点了：这一次只给这一个选项
  }
  for (const r of W.requests.filter((r) => r.status === 'accepted' && r.to === id)) {
    extras.push({ kind: 'request', rid: r.rid, place: CHARS[r.from].home, act: 'errand', label: `帮${CHARS[r.from].name}：${r.text}`, minutes: [30, 60], w: 4 });
  }
  const awake = others.filter((o) => !o.asleep && !o.travel).map((o) => o.id);
  for (const e of inviteIdeas(W, id, gm, (k) => (k === 'weather' ? W.weather.today : null), awake)) {
    const o = others.find((x) => x.id === e.talk);
    extras.push({ ...e, place: o?.place || CHARS[e.talk].home });
  }
  const bagN = (pred) => (W.inv[id] || []).filter((it) => !it.uid && pred(it)).reduce((n, it) => n + (it.n || 1), 0);
  for (const e of projectOptions(W, id, gm, getter(W, null, gm, { fish: bagN((it) => it.k === 'fish'), bagfood: bagN((it) => ITEMS[it.k]?.food) }))) extras.push(e);
  const food = bagFood(W, id);
  if (food && c.stats.food < 60) extras.push({ kind: 'bag', place: pos.place || (pos.inside ? Object.keys(PLACES).find((k) => PLACES[k].inside === pos.inside) : CHARS[id].home), act: 'eat', label: `吃随身带的${food}`, minutes: [10, 20], w: 2, tags: ['food'] });
  if (hostDue) return [{ ...hostDue, key: 'o1', line: `o1 ${PLACES[hostDue.place].name}·${hostDue.label}（你约的，该过去了）`, tags: [] }];
  const talkTopics = Object.fromEntries(IDS.filter((x) => x !== id).map((x) => [x, topics(W, id, x)]));
  return buildMenu({ W, gm, id, c, pos, others, today: c.today, extras, talkTopics }).filter((o) => !busyKey || (o.thing ? `${o.thing}.${o.verb}` : o.cid ? `c.${o.cid}` : '') !== busyKey).map((o, i) => ({ ...o, key: `o${i + 1}`, line: o.line.replace(/^o\d+/, `o${i + 1}`) }));
}

async function decide(id) {
  const c = S.chars[id], now = Date.now();
  worldTick(now);
  const keep = c.plan.filter((s) => s.t1 > now - 60000);
  c.plan = keep.length ? keep : c.plan.slice(-1);
  const t = Math.max(planEnd(c), now + 1500);
  const prev = lastAct(c);
  if (prev) applyStats(c, prev);
  const m = gameMin(t), h = hourOf(m);
  // 有人正朝她走过来（马上就到）：原地等她一下，不问模型
  const comer = IDS.find((o) => o !== id && S.chars[o].pending?.to === id && S.chars[o].pending.at > now - 2000 && S.chars[o].pending.at - t < 150000);
  if (comer && prev && prev.activity !== 'sleep') {
    const e = endPos(c), until = Math.max(t + 15000, S.chars[comer].pending.at + 20000);
    c.plan.push({ id: ++S.seq, kind: 'act', area: e.area, inside: e.inside || null, x: e.x, y: e.y, place: e.place, activity: 'rest', anim: 'idle', icon: 'chat', doing: `等${CHARS[comer].name}过来`, says: [], t0: t, t1: until });
    save();
    return;
  }
  // 深夜不再问模型：直接回家睡，睡前写日记
  if ((h >= 23 || h < 5) || (prev?.activity === 'sleep' && h < 6.5)) return goSleep(id, c, t);
  const menu = menuFor(id, c, t);
  const raw = await llm(id, 'decide', [{ role: 'system', content: systemPrompt(id, DECIDE_OUT) }, { role: 'user', content: situation(id, c, t, menu) }], 1300);
  if (raw && menu.length === 1 && menu[0].kind === 'gathering') { raw.option = 'o1'; raw.talk_to = ''; } // 自己约的事到点了：想法和说的话照用，人得过去
  const d = validate(id, c, raw || fallbackDecision(id, c, menu), menu);
  d.byModel = !!raw;
  if (raw) {
    d.raw = raw;
    learnTr(raw, [[d.thought, 'thought', 90], [cut(raw.doing, 16) && d.doing, 'doing', 16], [d.say, 'say', 30], [d.log, 'log', 40], [d.remember, 'remember', 40], [d.write, 'write', 30]]);
    if (d.proj && d.write) learnTr(raw, [[projClean(d.write, 12), 'write', 12], [projClean(d.write, 40), 'write', 40]]); // 项目里留下的是去掉标点的篇名 / 段落
  }
  c.inbox = [];
  if (d.activity === 'sleep') return goSleep(id, c, Math.max(planEnd(c), now + 1500), d);
  act(id, c, d, Math.max(planEnd(c), now + 1500));
}

// 这件事用哪一行动画：物件动作、项目、地点（坐下、荡秋千、蹲着）、活动，依次往下找
const byChar = (v, id) => (typeof v === 'string' ? v : v ? v[id] ?? v['*'] ?? null : null);
function poseFor(id, d, gx) {
  if (gx) { const a = gatheringAnim(gx, id); if (a) return a; }
  if (d.thing && d.verb) { const v = byChar(POSES.verbs[`${d.thing}.${d.verb}`], id); if (v) return v; }
  if (d.proj) { const v = byChar(POSES.projects[d.proj], id); if (v) return v; }
  const pl = POSES.places[d.place]; if (pl) { const v = byChar(pl[d.activity] ?? pl['*'], id); if (v) return v; }
  return byChar(POSES.acts[d.activity], id);
}
function act(id, c, d, t) {
  // 想和人聊天：对方在同一个区域（没睡、不在路上）就走到她旁边
  let target, chatWith = null, sayNow = false;
  const p = PLACES[d.place];
  const lastTalkAgo = d.talk && c.lastTalk?.[d.talk] !== undefined ? gameMin(t) - c.lastTalk[d.talk] : Infinity;
  if (d.talk && lastTalkAgo < 60) d.talk = '';
  if (d.talk) {
    // 她正在走路或赶路的话，去她要去的地方等她
    const o = S.chars[d.talk], cur = posAt(o, t), q = cur.seg.kind === 'act' ? cur : endPos(o);
    const me = posAt(c, t);
    const here = !me.travel && me.area === q.area && (q.inside ? me.inside === q.inside : !me.inside && Math.hypot(me.x - q.x, me.y - q.y) < 220);
    // 要去找她（想聊天，或要去的店里正好有她）才走过去；否则只是顺口一句（比如道别），在原地说完再走
    const goTo = d.activity === 'chat' || (q.inside && PLACES[d.place]?.inside === q.inside);
    if (cur.seg.activity !== 'sleep' && q.area && !goTo && here) { chatWith = d.talk; sayNow = true; }
    else if (cur.seg.activity !== 'sleep' && q.area && goTo) {
      chatWith = d.talk;
      if (q.inside) {
        d.place = Object.keys(PLACES).find((k) => PLACES[k].inside === q.inside);
        target = { area: q.area, inside: q.inside, at: SHOPS[q.inside].stand };
        const ok = PLACES[d.place].acts.filter((a) => (a !== 'work' && a !== 'sleep') || d.place === CHARS[id].home);
        if (!ok.includes(d.activity)) d.activity = 'chat';
      } else {
        d.place = q.place && PLACES[q.place] ? q.place : null;
        target = { area: q.area, at: standAt(q.area, [q.x + (Math.random() < 0.5 ? -56 : 56), q.y + 6], id), label: CHARS[d.talk].name + '身边' };
        d.activity = 'chat';
      }
    }
  }
  if (!target) target = p.inside ? { area: p.area, inside: p.inside, at: SHOPS[p.inside].stand } : { area: p.area, at: standAt(p.area, p.stand, id), label: p.name };
  const gx = d.gid ? S.world.gatherings.find((x) => x.gid === d.gid) : null;
  if (!chatWith && p.fly && id === 'gpt' && THINGS[d.thing]?.verbs?.[d.verb]?.fly) { target.fly = p.fly; target.flyName = p.flyName; } // GPT 飞到灯塔上
  const from = endPos(c), wasAsleep = lastAct(c)?.activity === 'sleep';
  const { segs, t: arrive } = planRoute(id, c, target, t);
  if (wasAsleep) addLog(id, from.area, `${CHARS[id].name} 起床了`, t);
  if (from.area !== target.area) addLog(id, target.area, `${CHARS[id].name} 去了${AREAS[target.area].name}`, segs.find((x) => x.kind === 'travel')?.t1 ?? arrive, false, { kind: 'move' });
  if (d.activity === 'chat') d.minutes = Math.min(d.minutes, 45);
  // 走过去找人聊天时，这件事就是聊天（只看地点：长椅上就坐着聊）；只是顺口说一句再走（sayNow）的，原来要做的事照做
  const walkOver = chatWith && !sayNow;
  const anim0 = ANIM[id][d.activity] || 'idle', anim = poseFor(id, walkOver ? { place: d.place, activity: d.activity } : d, walkOver ? null : gx) || anim0;
  const icon = d.activity === 'work' ? ANIM[id].workIcon : ACTIVITIES[d.activity].icon;
  let startAt = arrive;
  if (gx) { // 约好的事：早到就先等一会儿，活动从约定时间开始、到约定时间结束
    const at = Date.now() + realMs(gx.at - gameMin(Date.now()));
    if (at > arrive + 3000) { segs.push({ id: ++S.seq, kind: 'act', area: target.area, inside: target.inside || null, x: Math.round(target.at[0]), y: Math.round(target.at[1]), place: d.place, activity: 'rest', anim: 'idle', icon: 'sparkle', doing: `等${gatheringName(gx)}开始`, says: [], t0: arrive, t1: at }); startAt = at; }
    d.minutes = Math.max(10, gx.until - Math.max(gameMin(startAt), gx.at));
    d.doing = gatheringDoing(gx, id);
  }
  const seg = {
    id: ++S.seq, kind: 'act', area: target.area, inside: target.inside || null, x: Math.round((target.fly || target.at)[0]), y: Math.round((target.fly || target.at)[1]),
    place: d.place, activity: d.activity, anim, anim0, icon, doing: d.doing, thought: d.thought, byModel: d.byModel, with: walkOver ? chatWith : undefined,
    who: id, thing: walkOver ? null : d.thing, verb: walkOver ? null : d.verb, cid: walkOver ? null : d.cid, proj: walkOver ? undefined : d.proj || undefined, text: d.write || undefined,
    gid: gx?.gid, rid: d.rid || undefined, bag: d.bag || undefined, flyBack: target.fly ? target.at.map(Math.round) : undefined,
    says: d.say && !sayNow ? [{ t0: startAt + 600, t1: startAt + 11000, text: d.say }] : [], t0: startAt, t1: startAt + realMs(d.minutes),
  };
  if (d.say && sayNow) (segs[0] || seg).says = [{ t0: t + 300, t1: t + 9000, text: d.say }]; // 出发前当场说
  c.plan.push(...segs, seg);
  const at = gameMin(t);
  if (d.thought) c.thoughts.push({ text: d.thought, at: t, day: dayOf(at), t: hm(at) });
  if (c.thoughts.length > 80) c.thoughts.splice(0, c.thoughts.length - 80);
  const am = gameMin(arrive), where = target.inside ? SHOPS[target.inside].name : target.label || AREAS[target.area].name;
  c.today.push({ t: hm(am), text: `${where}：${d.doing}${d.say ? `，说「${d.say}」` : ''}`, doing: d.doing, key: d.optKey, place: d.place });
  if (d.thought) noteText(S.world, id, d.thought);
  // 读别人借给她的新书：记住其中一句，也成了她们之间能聊的事
  if (d.activity === 'read' && !chatWith) for (const it of (S.world.inv[id] || []).filter((x) => x.parts?.length && x.owner !== id)) {
    const orig = (S.world.inv[it.owner] || []).find((x) => x.uid === it.uid) || it;
    if ((orig.readBy || []).includes(id)) continue;
    orig.readBy = [...(orig.readBy || []), id];
    const line = it.parts[Math.floor(Math.random() * it.parts.length)];
    remember(c, { text: cut(`读了${CHARS[it.owner].name}的${it.name}，喜欢「${line}」`, 40), imp: 2, day: dayOf(am), at: arrive });
    addLog(id, target.area, `${CHARS[id].name}读完了${CHARS[it.owner].name}借给她的${it.name}`, arrive);
    episode({ title: `${CHARS[id].name}读了${CHARS[it.owner].name}的${it.name}`, who: [id, it.owner], lines: [[id, line]], w: 2 }, am);
    break;
  }
  if (d.log && (d.importance >= 2 || !(am - (c.lastLog ?? -1e9) < 90))) { addLog(id, target.area, d.log, arrive, d.importance >= 3); c.lastLog = am; }
  if (d.remember) remember(c, { text: d.remember, imp: d.importance, day: dayOf(am), at: arrive });
  // 送东西、请人帮忙、约人：对象要在身边（或者正走过去找她）
  const W = S.world, gmNow = gameMin(t), target2 = (spec) => IDS.find((x) => x !== id && String(spec || '').split(/[:：]/)[0].trim() === x) || IDS.find((x) => x !== id && String(spec || '').startsWith(CHARS[x].name));
  const nearNow = (x) => { const a = posAt(c, t), b = posAt(S.chars[x], t); return !a.travel && !b.travel && a.area === b.area && (a.inside ? a.inside === b.inside : !b.inside && Math.hypot(a.x - b.x, a.y - b.y) < 220); };
  let asked = null, invited = null, gave = null;
  if (d.give) { const to = target2(d.give); if (to && (nearNow(to) || to === chatWith)) gave = give(W, id, to, d.give.split(/[:：]/).slice(1).join(':'), socialHooks); if (gave && !/还给/.test(gave)) relBump(to, id, 1); }
  if (d.ask) { const to = target2(d.ask); if (to && (nearNow(to) || to === chatWith) && posAt(S.chars[to], t).seg.activity !== 'sleep') asked = askFor(W, id, to, d.ask.split(/[:：]/).slice(1).join(':') || d.ask, gmNow); }
  if (asked && d.raw) learnTr(d.raw, [[asked.text, (o) => String(o.ask || '').replace(/^\s*[a-z]+\s*[:：]\s*/i, ''), 24]]);
  if (d.invite) invited = invite(W, id, d.invite, gmNow, (k) => (k === 'weather' ? W.weather.today : null), socialHooks);
  // 等对方回应：记在状态里，服务重启后也会接着处理（请她帮忙、约她、送她东西时也要等她回一句）
  const replyTo = chatWith || asked?.to || (invited && invited.invited.find((x) => nearNow(x))) || null;
  if (replyTo && (d.say || asked || invited || gave)) {
    c.pending = { to: replyTo, said: d.say || '', at: chatWith && !sayNow ? arrive : t, ask: asked?.text || '', invite: invited && invited.invited.includes(replyTo) ? `${hm(invited.at)}${gatheringName(invited)}` : '', gave: gave || '' };
    scheduleReply(id);
  }
  save();
}
function scheduleReply(id) {
  const p = S.chars[id].pending;
  if (!p) return;
  setTimeout(() => {
    if (S.chars[id].pending !== p) return;
    S.chars[id].pending = null;
    reply(p.to, id, p.said, p.at, p).catch((e) => console.error('[sim] reply', e));
  }, Math.max(0, p.at - Date.now()) + 1500);
}

// 被搭话的人用自己的模型回应
async function reply(id, fromId, said, at, extra = {}) {
  const c = S.chars[id], from = CHARS[fromId], now = Date.now(), when = Math.min(now, at || now), q = posAt(c, when), a = posAt(S.chars[fromId], when);
  if (q.travel || a.travel || q.seg.activity === 'sleep' || !(said || extra.ask || extra.invite || extra.gave)) return;
  const near = q.area === a.area && (q.inside ? q.inside === a.inside : !a.inside && Math.hypot(q.x - a.x, q.y - a.y) < 320);
  if (!near) return; // 走到时她已经走开了
  const m = gameMin(now);
  const user = `现在是第 ${dayOf(m)} 天 ${hm(m)}。你在${whereText(q)}，${q.seg.doing}。
${said ? `${from.name} 走到你身边对你说：「${said}」` : `${from.name} 来到你身边。`}${extra.ask ? `\n她请你帮忙：${extra.ask}` : ''}${extra.invite ? `\n她约你：${extra.invite}` : ''}${extra.gave ? `\n${extra.gave}。` : ''}
${betweenLines(S.world, id, fromId, m).map((l) => `（${l}）`).join('')}
你对她的印象：${c.rel[fromId] ? `${c.rel[fromId].v} 分，${c.rel[fromId].label}` : '还不熟'}。
你最近的念头：${c.thoughts.slice(-2).map((x) => x.text).join(' / ') || '（暂无）'}
你记得的事：
${memLines(c)}
请自然地回应她。`;
  const out = `【输出】只输出一个 JSON 对象：{"say": "你说出口的回答（≤30字）", "thought": "此刻的内心独白（≤40字）", "remember": "值得记住的事（≤30字），没有就空字符串", "answer": "她请你帮忙或约你时填 yes 或 no，否则空字符串", "promise": "你答应她的一件事（≤20字），没有就空字符串", "give": "顺手回赠的东西，如 ${fromId}:橘子，没有就空字符串",
${triOut([['say'], ['thought'], ['remember'], ['promise']])}}`;
  const r = await llm(id, 'reply', [{ role: 'system', content: systemPrompt(id, out) }, { role: 'user', content: user }], 800);
  const answer = cut(r?.say, 40);
  if (!answer) return;
  learnTr(r, [[answer, 'say', 40], [cut(r.thought, 90), 'thought', 90], [cut(r.remember, 40), 'remember', 40], [cut(r.promise, 20), 'promise', 20]]);
  const W = S.world;
  if (extra.ask) answerRequest(W, fromId, id, r.answer, socialHooks);
  if (extra.invite) {
    const x = W.gatherings.filter((g) => g.host === fromId && g.status === 'planned').at(-1);
    if (x && !/^y|好|行|可以|去/i.test(String(r.answer || ''))) x.invited = x.invited.filter((k) => k !== id);
  }
  if (cut(r.promise, 20) && !extra.invite) addPromise(W, id, fromId, cut(r.promise, 20), dayOf(gameMin(Date.now())));
  if (cut(r.give, 30) && String(r.give).split(/[:：]/)[0].trim() === fromId) { const g = give(W, id, fromId, String(r.give).split(/[:：]/).slice(1).join(':'), socialHooks); if (g && !/还给/.test(g)) relBump(fromId, id, 1); }
  const t0 = Date.now() + 800, seg = posAt(c, t0).seg;
  if (seg.kind === 'act' && !seg.with) seg.with = fromId; // 房间里据此让说话的两个人面对面
  seg.says = [...(seg.says || []).filter((s) => s.t1 < t0), { t0, t1: t0 + 11000, text: answer }];
  const hmNow = hm(gameMin(t0));
  if (r.thought) c.thoughts.push({ text: cut(r.thought, 90), at: t0, day: dayOf(gameMin(t0)), t: hmNow });
  const gmNow = gameMin(t0);
  c.lastTalk = { ...(c.lastTalk || {}), [fromId]: gmNow };
  S.chars[fromId].lastTalk = { ...(S.chars[fromId].lastTalk || {}), [id]: gmNow };
  c.inbox.push({ t: hmNow, text: `${from.name} 对你说「${said}」，你回答「${answer}」` });
  S.chars[fromId].inbox.push({ t: hmNow, text: `你对 ${CHARS[id].name} 说「${said}」，她回答「${answer}」` });
  c.today.push({ t: hmNow, text: `${from.name} 来找我聊天：「${said}」我说「${answer}」`, with: fromId });
  S.chars[fromId].today.push({ t: hmNow, text: `和 ${CHARS[id].name} 聊天：我说「${said}」她说「${answer}」`, with: id });
  if (r.remember) remember(c, { text: cut(r.remember, 40), imp: 1, day: dayOf(gameMin(t0)), at: t0 });
  hearsay(fromId, id, said); hearsay(id, fromId, answer);
  const pair = [fromId, id].sort().join('-'), gm = gameMin(t0);
  S.chatLog = S.chatLog || {};
  if (said && !(gm - (S.chatLog[pair] ?? -1e9) < 120)) { addLog(fromId, q.area, `${from.name} 和 ${CHARS[id].name} 聊天：「${said}」——「${answer}」`, t0); S.chatLog[pair] = gm; }
  episode({ title: `${from.name}和${CHARS[id].name}在${whereText(q)}说话`, who: [fromId, id], lines: [[fromId, said || extra.ask || extra.invite || ''], [id, answer]], w: extra.ask || extra.invite ? 2 : 1 }, gm);
  save();
}

// 听说：聊天里提到了黑板、公告栏这些写字的东西，而听的人还没去看过新内容，她会知道「那里有新东西」（不知道写了什么）
function hearsay(speaker, listener, text) {
  const W = S.world;
  for (const [tid, t] of Object.entries(THINGS)) {
    if (!t.text || !(t.hear || []).some((w) => String(text || '').includes(w))) continue;
    const st = W.things[tid], ver = st.ver || 0;
    if (!ver || (st.seen?.[listener] ?? -1) >= ver || (st.seen?.[speaker] ?? -1) < ver) continue;
    const last = (st.lines || st.names || []).at(-1), by = CHARS[last?.by]?.name || '有人';
    S.chars[listener].inbox.push({ t: hm(gameMin(Date.now())), text: `听${CHARS[speaker].name}说，${t.name}上${by}写了新东西（你还没去看）` });
  }
}
function goSleep(id, c, t, d = null) {
  const home = CHARS[id].home, p = PLACES[home];
  const m = gameMin(t);
  // 睡到第二天 6:30～7:30
  const wakeDay = hourOf(m) < 6.5 ? dayOf(m) : dayOf(m) + 1, wake = Math.max(wakeDay * 1440 + rnd(390, 450), m + 30);
  const { segs, t: arrive } = planRoute(id, c, { area: p.area, inside: home, at: SHOPS[home].stand }, t);
  const end = Math.max(arrive + 20000, t + realMs(wake - m));
  if (lastAct(c)?.activity !== 'sleep') addLog(id, p.area, `${CHARS[id].name} 回${SHOPS[home].name}睡觉了`, arrive);
  c.plan.push(...segs, { id: ++S.seq, kind: 'act', area: p.area, inside: home, x: SHOPS[home].stand[0], y: SHOPS[home].stand[1], place: home, activity: 'sleep', anim: 'sleep', anim0: 'sleepy', icon: 'zzz', doing: d?.doing || '在睡觉', thought: d?.thought || '', says: [], t0: arrive, t1: end });
  if (d?.thought) c.thoughts.push({ text: d.thought, at: t, day: dayOf(m), t: hm(m) });
  c.inbox = [];
  save();
  if (c.today.length && c.diaryDay !== dayOf(m - 300)) writeDiary(id, c, t).catch((e) => console.error('[sim] diary', e));
}

async function writeDiary(id, c, t) {
  const m = gameMin(t), day = dayOf(m - 300); // 凌晨睡觉的话算前一天
  c.diaryDay = day;
  const out = `【输出】只输出一个 JSON 对象：
{"mood": "今天的心情（2～4字）",
 "diary": "今天的日记，第一人称，像真的日记一样自然（80～160字）",
 "memory": "今天最值得记住的一件事（≤30字）",
 "importance": 1到3的整数,
 "tomorrow": "明天最想做的一件事（≤16字）",
 "joke": {"with": "和你有个小梗的人的 id（ds/claude/gpt）", "text": "你们之间今天冒出来的一个小梗或口头禅（≤16字）"} 或 null,
 "relations": {"ds 或 claude 或 gpt（对方的 id）": {"delta": -5到5的整数, "label": "现在对她的一句话印象（≤16字）"}},
 "en": {"mood": "mood的英文版", "diary": "diary的英文版", "memory": "memory的英文版", "tomorrow": "tomorrow的英文版", "joke": "joke.text的英文版（没有 joke 就空字符串）", "relations": {"对方的 id": "label的英文版"}},
 "ja": {"mood": "mood的日文版", "diary": "diary的日文版", "memory": "memory的日文版", "tomorrow": "tomorrow的日文版", "joke": "joke.text的日文版（没有 joke 就空字符串）", "relations": {"对方的 id": "label的日文版"}}}`;
  const user = `现在是第 ${day} 天 ${hm(m)}，你准备睡觉了，睡前写今天的日记。
你今天做过的事：
${c.today.map((x) => `- ${x.t} ${x.text}`).join('\n')}
你今天的念头：
${c.thoughts.filter((x) => x.day === day).map((x) => `- ${x.t} ${x.text}`).join('\n') || '（没记下来）'}
今天街上的事：
${S.log.filter((e) => e.day === day && !/去了|起床了|睡觉了/.test(e.text)).slice(-10).map((e) => `- ${e.t} ${e.text}`).join('\n') || '（很平静）'}
今天和你有关的事件：
${S.world.episodes.filter((e) => e.day === day && e.who.includes(id)).slice(-6).map((e) => `- ${e.t} ${e.title}${(e.lines || []).length ? '：' + e.lines.map(([w, l]) => `${CHARS[w]?.name || w}「${l}」`).join(' ') : ''}`).join('\n') || '（没有）'}
你对别人的印象：${relLine(id, c)}`;
  const r = await llm(id, 'diary', [{ role: 'system', content: systemPrompt(id, out) }, { role: 'user', content: user }], 2000);
  c.today = [];
  if (!r || !cut(r.diary, 400)) return;
  const at = Date.now();
  learnTr(r, [[cut(r.mood, 8), 'mood', 8], [cut(r.diary, 400), 'diary', 400], [cut(r.memory, 40), 'memory', 40], [cut(r.tomorrow, 20), 'tomorrow', 20],
    [r.joke && typeof r.joke === 'object' ? String(r.joke.text || '').trim().slice(0, 16) : '', (o) => (typeof o.joke === 'object' ? o.joke?.text : o.joke), 16],
    ...Object.entries(r.relations || {}).map(([k, v]) => [typeof v === 'object' ? cut(v?.label, 20) : '', (o) => { const x = o.relations?.[k]; return typeof x === 'object' ? x?.label : x; }, 20])]);
  c.diary.push({ day, mood: cut(r.mood, 8), text: cut(r.diary, 400), at });
  if (r.memory) remember(c, { text: cut(r.memory, 40), imp: clamp(Math.round(Number(r.importance) || 2), 1, 3), day, at });
  noteText(S.world, id, r.diary);
  if (cut(r.tomorrow, 20)) S.world.todo[id] = [{ text: cut(r.tomorrow, 20), day: day + 1 }];
  if (r.joke && typeof r.joke === 'object' && IDS.includes(r.joke.with) && r.joke.with !== id) addJoke(S.world, id, r.joke.with, r.joke.text, day);
  const idOf = (k) => IDS.find((x) => x === k || CHARS[x].name.toLowerCase() === String(k).trim().toLowerCase());
  for (const [raw, v] of Object.entries(r.relations || {})) {
    const k = idOf(raw);
    if (!k || !c.rel[k] || typeof v !== 'object') continue;
    c.rel[k].v = clamp(c.rel[k].v + clamp(Math.round(Number(v.delta) || 0), -5, 5), 0, 100);
    if (cut(v.label, 20)) c.rel[k].label = cut(v.label, 20);
  }
  addLog(id, PLACES[CHARS[id].home].area, `${CHARS[id].name} 写完了第 ${day} 天的日记`, at);
  save();
}

// ---------- 循环 ----------
const busy = new Set(), retryAt = {};
let comicBusy = false, paperBusy = false;
// 物件动作：到点开始、到点结算（幂等：started / settled 标记）
const hooks = {
  log: (who, area, text, star) => addLog(who, area, text, Date.now(), star),
  parcel: (who, to) => takeParcel(S.world, who, to, socialHooks),
  // 新书写完：成为 Claude 随身的一本书（可以借给别人读），段落就是她每一步写下的句子
  book: (title, proj) => { const W = S.world; W.inv[proj.owner]?.push({ k: 'newbook', uid: newUid(W, 'b'), owner: proj.owner, name: `《${title}》`, parts: proj.parts.map((x) => x.text) }); },
};
const useItem = (who, k) => { const W = S.world, it = (W.inv[who] || []).find((x) => x.k === k && !x.uid); if (!it) return false; it.n = (it.n || 1) - 1; if (it.n <= 0) W.inv[who] = W.inv[who].filter((x) => x !== it); return true; };
const projHooks = (gm) => ({ ...socialHooks, log: (who, area, text, star) => addLog(who, area, text, Date.now(), star), useItem, ctx: (proj, vars) => ctxFor(S.world, null, proj.owner, gm, hooks, { vars, project: proj, area: 'square' }) });
// 三天前的事件簿搬到 data/days/<天>.json，提示词和漫画不再读它
function archiveEpisodes(gm) {
  const W = S.world, today = dayOf(gm);
  if (W.archived === today) return;
  W.archived = today;
  const old = W.episodes.filter((e) => e.day <= today - 3);
  if (!old.length) return;
  mkdirSync(`${DATA}days`, { recursive: true });
  for (const day of new Set(old.map((e) => e.day))) {
    const f = `${DATA}days/${day}.json`, prev = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : { day, episodes: [] };
    prev.episodes.push(...old.filter((e) => e.day === day && !prev.episodes.some((x) => x.id === e.id)));
    writeFileSync(f, JSON.stringify(prev));
  }
  W.episodes = W.episodes.filter((e) => e.day > today - 3);
}
function worldTick(now) {
  const gm = gameMin(now);
  worldClock(S.world, gm, hooks);
  const ctxAt = (area) => ctxFor(S.world, null, 'town', gm, hooks, { area });
  calendarTick(S.world, gm, ctxAt, hooks);
  incidentTick(S.world, gm, getter(S.world, null, gm), ctxAt, hooks);
  socialTick(S.world, gm, socialHooks);
  archiveEpisodes(gm);
  let changed = false;
  for (const id of IDS) for (const seg of S.chars[id].plan) {
    if (seg.kind !== 'act') continue;
    if (seg.gid && !seg.joined && seg.t0 <= now) { seg.joined = true; const x = S.world.gatherings.find((g) => g.gid === seg.gid); if (x && x.status !== 'done' && gm < x.until && !x.present.includes(id)) x.present.push(id); changed = true; }
    if (seg.rid && !seg.settled && seg.t1 <= now) { seg.settled = true; finishRequest(S.world, seg.rid, socialHooks, gm); changed = true; }
    if (seg.proj && !seg.settled && seg.t1 <= now) { seg.settled = true; projectStep(S.world, seg, gm, projHooks(gm)); changed = true; }
    if (seg.bag && !seg.settled && seg.t1 <= now) { seg.settled = true; const f = eatFromBag(S.world, id); if (f) S.chars[id].stats.food = Math.min(100, S.chars[id].stats.food + f.food); changed = true; }
    if (!(seg.thing || seg.cid)) continue;
    if (!seg.started && seg.t0 <= now) { seg.started = true; seg.who = seg.who || id; startVerb(S.world, seg, gm, hooks); changed = true; }
    if (!seg.settled && seg.t1 <= now) { seg.settled = true; seg.who = seg.who || id; settleVerb(S.world, seg, gm, hooks); changed = true; }
  }
  if (changed) save();
}
// 约好的事：到点开始，进行到 1/3 和 2/3 时在场的人轮流说一句（各用自己的模型），结束时记一笔
const SCENE_OUT = `【输出】只输出一个 JSON 对象：{"say": "这一轮你说的一句话（≤30字）", "thought": "此刻的内心独白（≤40字）",
${triOut([['say'], ['thought']])}}`;
// 聚会时手边的话题：读书会读主人最新写完的书；流星雨夜、灯笼节就说正在发生的事
function sceneTopic(x, m) {
  const book = (S.world.inv[x.host] || []).filter((it) => it.parts?.length).at(-1);
  if (x.kind === 'reading' && book) return `今晚读的是${CHARS[x.host].name}的新书${book.name}，读到这一段：「${book.parts[Math.floor(m / 7) % book.parts.length]}」`;
  const on = activeEvents(m).map((e) => e.name);
  return on.length ? `此刻正赶上${on.join('、')}` : '';
}
async function sceneRound(x) {
  const order = [x.host, ...x.present.filter((k) => k !== x.host)].filter((k) => x.present.includes(k));
  for (const [i, id] of order.entries()) {
    const c = S.chars[id], m = gameMin(Date.now()), topic = sceneTopic(x, m);
    const user = `现在是第 ${dayOf(m)} 天 ${hm(m)}。你正在参加${gatheringName(x)}（${PLACES[x.place].name}，${CHARS[x.host].name}约的），在场的有：${x.present.map((k) => CHARS[k].name).join('、')}。${topic ? `\n${topic}。` : ''}
${x.lines.length ? `刚才大家说的：\n${x.lines.slice(-6).map(([w, l]) => `- ${CHARS[w].name}：${l}`).join('\n')}` : '活动刚开始。'}
${x.present.filter((k) => k !== id).flatMap((k) => betweenLines(S.world, id, k, m)).map((l) => `（${l}）`).join('')}
你最近的念头：${c.thoughts.slice(-2).map((t) => t.text).join(' / ') || '（暂无）'}
轮到你说一句，自然地接着大家的话。`;
    const r = await llm(id, 'scene', [{ role: 'system', content: systemPrompt(id, SCENE_OUT) }, { role: 'user', content: user }], 800);
    const say = cut(r?.say, 40); if (!say) continue;
    learnTr(r, [[say, 'say', 40], [cut(r.thought, 90), 'thought', 90]]);
    x.lines.push([id, say]);
    const t0 = Date.now() + 500 + i * 3000, seg = posAt(c, t0).seg;
    seg.says = [...(seg.says || []).filter((q) => q.t1 < t0), { t0, t1: t0 + 10000, text: say }];
    if (r.thought) c.thoughts.push({ text: cut(r.thought, 90), at: t0, day: dayOf(m), t: hm(m) });
  }
  save();
}
const sceneBusy = new Set();
function gatheringTick(now) {
  const W = S.world, gm = gameMin(now);
  calendar(W, gm, ((dayOf(gm) - 1) % 7 + 7) % 7 + 1, socialHooks);
  for (const x of W.gatherings) {
    if (x.status === 'planned' && gm >= x.at) x.status = 'running';
    if (x.status !== 'running') continue;
    for (const id of IDS) { // 没走「赴约」选项、但人确实在场（比如过来聊天）的也算到场
      if (x.present.includes(id) || gm >= x.until) continue;
      const q = posAt(S.chars[id], now);
      if (!q.travel && q.seg.kind === 'act' && q.seg.activity !== 'sleep' && (q.seg.place === x.place || (PLACES[x.place].inside && q.seg.inside === PLACES[x.place].inside))) x.present.push(id);
    }
    const len = x.until - x.at, due = gm >= x.at + len * (x.rounds + 1) / 3;
    if (gm < x.until && x.rounds < 2 && due && x.present.length >= 2 && !sceneBusy.has(x.gid)) {
      x.rounds++; sceneBusy.add(x.gid);
      sceneRound(x).catch((e) => console.error('[sim] scene', e)).finally(() => sceneBusy.delete(x.gid));
    }
    if (gm >= x.until) {
      x.status = 'done';
      const name = gatheringName(x), place = PLACES[x.place].name.replace('（店里）', '');
      if (x.present.length >= 2) {
        const title = `${x.present.map((k) => CHARS[k].name).join('、')}在${place}${name}`;
        addLog(x.host, PLACES[x.place].area, title, now, x.kind === 'reading' || x.kind === 'stargaze');
        episode({ title, who: x.present, lines: x.lines.slice(-6), w: 3 }, gm);
        addShared(W, x.present, title, dayOf(gm));
        for (const a of x.present) for (const b of x.present) if (a !== b) relBump(a, b, 1);
      } else {
        const title = x.present.length ? `${name}没有人来，${CHARS[x.present[0]].name}一个人${x.kind === 'reading' ? '读完了第一章' : '待了一会儿'}` : `约好的${name}谁也没去`;
        addLog(x.host, PLACES[x.place].area, title, now);
        episode({ title, who: x.present.length ? x.present : [x.host], w: 2 }, gm);
      }
      save();
    }
  }
}
function tick() {
  const now = Date.now();
  try { worldTick(now); gatheringTick(now); } catch (e) { console.error('[sim] world', e); }
  // 每小时一张漫画（config.comic.enabled 打开后才画）
  if (cfg.comic?.enabled && !comicBusy && S.llm.status !== 'credit' && now - (S.lastComic || 0) >= (cfg.comic.everyMinutes || 60) * 60000) {
    comicBusy = true;
    const from = S.lastComic || now - 3600000;
    makeComic(S, from, now, cfg)
      .then((c) => { S.lastComic = now; if (c && c.kind !== 'none') { addLog('town', 'square', `${c.kind === 'cg' ? '新 CG' : '新漫画'}《${c.title}》画好了`, Date.now(), c.kind === 'cg', { comic: c.id }); save(); } })
      .catch((e) => { if (e instanceof CreditExhausted) S.llm = { status: 'credit', error: '中转站额度用完了' }; console.error('[sim] comic', String(e.message || e).slice(0, 200)); S.lastComic = now - 50 * 60000; }) // 失败了 10 分钟后再试；额度用完就停
      .finally(() => { comicBusy = false; });
  }
  const gm = gameMin(now), yday = dayOf(gm) - 1;
  if (cfg.paper?.enabled !== false && !paperBusy && S.llm.status !== 'credit' && yday >= 1 && (hourOf(gm) >= 7 || IDS.every((id) => S.chars[id].diary.some((d) => d.day === yday)) || (hourOf(gm) >= 1 && IDS.every((id) => posAt(S.chars[id], now).seg.activity === 'sleep'))) && (S.lastPaperDay || 0) < yday && now > (S.paperRetry || 0)) {
    paperBusy = true;
    makePaper(dayBundle(yday), cfg)
      .then((p) => { S.lastPaperDay = yday; if (p) { addLog('town', 'square', `《鲸巷日报》第 ${yday} 天：${p.headline}`, Date.now(), true); } save(); })
      .catch((e) => { if (e instanceof CreditExhausted) S.llm = { status: 'credit', error: '中转站额度用完了' }; console.error('[sim] paper', String(e.message || e).slice(0, 200)); S.paperRetry = Date.now() + 10 * 60000; })
      .finally(() => { paperBusy = false; });
  }
  for (const id of IDS) {
    if (busy.has(id) || (retryAt[id] || 0) > now) continue;
    const c = S.chars[id];
    if (planEnd(c) - now > LEAD * 1000) continue;
    busy.add(id);
    decide(id)
      .catch((e) => { console.error(`[sim] decide ${id}`, e); retryAt[id] = Date.now() + 30000; })
      .finally(() => busy.delete(id));
  }
}

export function start() {
  load();
  for (const id of IDS) if (S.chars[id].pending && S.chars[id].pending.at > Date.now() - 60000) scheduleReply(id); else S.chars[id].pending = null;
  save(true);
  timer = setInterval(tick, 1000);
  tick();
  console.log(`[sim] started — day ${dayOf(gameMin(Date.now()))} ${hm(gameMin(Date.now()))}, model ${cfg.model}, llm ${cfg.enabled ? 'on' : 'off'}`);
}
export const stateVer = () => S?.ver ?? 0;
export function stop() { clearInterval(timer); closeCodex(); if (S) save(true); }

// 给页面的快照：只放展示需要的东西
export function snapshot() {
  const now = Date.now();
  return {
    now, ver: S.ver,
    clock: { epoch: S.clock.epoch, base: S.clock.base, speed: SPEED },
    llm: { status: S.llm.status, error: S.llm.error || null, calls: S.usage.calls || 0, cost: Math.round((S.usage.cost || 0) * 1e5) / 1e5 },
    chars: Object.fromEntries(IDS.map((id) => {
      const c = S.chars[id];
      return [id, {
        model: (cfg.models[id] || cfg.model).replace(/^(codex|claude):/, ''),
        stats: c.stats,
        plan: (c.plan.some((s) => s.t1 > now - 3000) ? c.plan.filter((s) => s.t1 > now - 3000) : c.plan.slice(-1)).map(({ applied, ...s }) => s),
        thoughts: c.thoughts.slice(-30),
        diary: c.diary.slice(-10),
        memories: [...c.memories].sort((a, b) => b.imp - a.imp || b.at - a.at).slice(0, 14),
        rel: c.rel,
      }];
    })),
    log: (() => { const ids = comicTitles(); return S.log.slice(-160).map((e) => logTags(e, ids)); })(),
    world: { ...worldSnapshot(S.world),
      inv: Object.fromEntries(IDS.map((id) => [id, invText(S.world, id, '她')])),
      gatherings: S.world.gatherings.filter((x) => x.status !== 'done' || gameMin(now) - x.until < 240).map(({ gid, kind, host, place, at, until, invited, present, status, lines, title }) => ({ gid, kind, name: gatheringName({ kind, title }), host, place, where: PLACES[place]?.name.replace('（店里）', '') || place, at: hm(at), until: hm(until), invited, present, status, lines: lines.slice(-6) })),
      requests: S.world.requests.filter((r) => ['asked', 'accepted'].includes(r.status) || gameMin(now) / 1440 - r.day < 1).map(({ from, to, text, status }) => ({ from, to, text, status })),
      projects: projectSnapshot(S.world),
      events: { today: todayEvents(gameMin(now)), active: activeEvents(gameMin(now)) },
      bonds: Object.fromEntries(Object.entries(S.world.bonds).map(([k, b]) => [k, { jokes: b.jokes.map((j) => j.text), owe: b.owe, promises: b.promises.filter((p) => p.status === 'open').map(({ by, to, text }) => ({ by, to, text })), shared: b.shared.slice(-3).map((s) => s.t) }])),
    },
  };
}
