// 世界状态：物件的状态、天气、街坊委托、事件簿。内容在 content/*.json，规则由 rules.mjs 执行。
// 模型只负责选择要做什么；世界怎么变，由这里按内容数据结算。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apply, cond, fill, seeded } from './rules.mjs';
import { PLACES, SHOPS, AREAS } from './world.mjs';
import { CHARS } from './personas.mjs';
import { ITEMS, addItem, eatFromBag } from './social.mjs';
import { forcedWeather, meteorAhead } from './events.mjs';

const read = (f) => JSON.parse(readFileSync(fileURLToPath(new URL(`./content/${f}`, import.meta.url)), 'utf8'));
// 物件要么固定在一个地点（place），要么跟着自己的状态走（placeFrom，比如猫今天在哪儿）
export const THINGS = Object.fromEntries(read('things.json').filter((t) => PLACES[t.place] || t.placeFrom).map((t) => [t.id, t]));
const WEATHER = read('weather.json'), NPCS = read('npcs.json');
export const NAMES = { ...Object.fromEntries(Object.entries(CHARS).map(([k, c]) => [k, c.name])), town: '街坊' };
export const weatherName = (w) => WEATHER.names[w] || w;

const dayOf = (gm) => Math.floor(gm / 1440), hourOf = (gm) => (gm % 1440) / 60;
const hm = (gm) => `${String(Math.floor(gm / 60) % 24).padStart(2, '0')}:${String(Math.floor(gm % 60)).padStart(2, '0')}`;
const parseAt = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
export const placeOf = (W, id) => { const t = THINGS[id]; return t?.placeFrom ? W.things[id]?.[t.placeFrom] : t?.place; };
export const ownerOf = (thingId) => { const p = PLACES[THINGS[thingId]?.place]; return p?.inside ? SHOPS[p.inside].owner : null; };
export const areaOf = (W, thingId) => PLACES[placeOf(W, thingId)]?.area || 'square';
const bagCount = (W, who, pred) => (W.inv?.[who] || []).filter((it) => !it.uid && pred(it)).reduce((n, it) => n + (it.n || 1), 0);

function rollWeather(prev, seed) {
  const r = seeded(seed)(), table = WEATHER.next[prev] || WEATHER.next.clear;
  let acc = 0;
  for (const [w, p] of Object.entries(table)) { acc += p; if (r < acc) return w; }
  return 'clear';
}
// 日程会定死某些日子的天气（流星雨那天一定是晴天）
const weatherFor = (d, prev) => forcedWeather(d) || rollWeather(prev, `w${d}`);

export function initWorld(gm) {
  const W = { v: 1, seq: 0, clock: Math.floor(gm), things: {}, cool: {}, episodes: [], todo: {}, passive: {}, daily: {}, weather: null };
  migrateWorld(W, gm);
  return W;
}
// 加了新物件时补上它的初始状态
export function migrateWorld(W, gm) {
  for (const [id, t] of Object.entries(THINGS)) {
    if (!W.things[id]) W.things[id] = { ...JSON.parse(JSON.stringify(t.state || {})), ver: 0, seen: {} };
    for (const [k, v] of Object.entries(t.state || {})) if (!(k in W.things[id])) W.things[id][k] = JSON.parse(JSON.stringify(v)); // 物件加了新字段
  }
  if (!W.weather) {
    const d = dayOf(gm), today = forcedWeather(d) || 'clear';
    W.weather = { day: d, today, tomorrow: weatherFor(d + 1, today), rain: WEATHER.rainHours[d % WEATHER.rainHours.length] };
  }
  W.cool = W.cool || {}; W.todo = W.todo || {}; W.passive = W.passive || {}; W.daily = W.daily || {}; W.episodes = W.episodes || [];
  // 每天定点的事从「下一次」开始算，不在建世界时补跑；委托板先放两张
  const d = dayOf(gm), mod = gm % 1440;
  for (const [id, t] of Object.entries(THINGS)) (t.daily || []).forEach((p, i) => { const at = parseAt(p.at); W.daily[`${id}.${i}`] ??= mod >= at ? d : d - 1; });
  if (W.things.cboard && !(W.things.cboard.list || []).length) refreshCommissions(W, gm, 2);
  return W;
}

// 条件里能用的名字
export function getter(W, thingId, gm, extra = {}) {
  const h = hourOf(gm), d = dayOf(gm), wx = W.weather;
  return (name) => {
    if (name === 'hour') return h;
    if (name === 'day') return d;
    if (name === 'weekday') return ((d - 1) % 7 + 7) % 7 + 1;
    if (name === 'weather') return wx.today;
    if (name === 'raining') return wx.today === 'rain' && h >= wx.rain[0] && h < wx.rain[1];
    if (name.startsWith('$')) return extra[name.slice(1)];
    if (name.includes('.')) { const [t, f] = name.split('.'); return W.things[t]?.[f]; }
    return W.things[thingId]?.[name];
  };
}

function commissionsText(W) {
  const open = (W.things.cboard?.list || []).filter((c) => c.status === 'open');
  return open.map((c) => `${c.npc}：${c.text}`).join('；') || '暂时没有新委托';
}
// 模板里除了物件自己的字段，还能用的几个词
function extrasFor(W, id) {
  const s = W.things[id] || {}, where = PLACES[placeOf(W, id)]?.name || '';
  return { commissions: commissionsText(W), where: where.replace(/^(广场|集市|后山|公园)的?/, ''), catname: s.name && s.name !== '-' ? `白猫「${s.name}」` : '白猫' };
}
export function showText(W, id) {
  const t = THINGS[id], s = W.things[id], get = getter(W, id, W.clock);
  const line = (t.show || []).find(([c]) => cond(c, get));
  return line ? fill(line[1], s, NAMES, extrasFor(W, id)) : t.name;
}

// 效果执行时的上下文；hooks: { log(who, area, text, star), episode(e) }
function ctxFor(W, thingId, who, gm, hooks, extra = {}) {
  const t = THINGS[thingId], rand = seeded(`${gm}|${thingId}|${who}|${W.seq}`);
  const ahead = meteorAhead(gm);
  const vars = { tomorrow: weatherName(W.weather.tomorrow), meteor: ahead ? `；${ahead.days === 1 ? '明晚' : '后天晚上'} 21:00 有流星雨！` : '', meteorlog: ahead ? `，还看到${ahead.days === 1 ? '明晚' : '后天晚上'}有流星雨` : '', ...(extra.vars || {}) };
  const words = () => ({ ...extrasFor(W, thingId), ...vars, who: NAMES[who] || '', text: extra.text || '' });
  const ctx = {
    W, thing: thingId, who, gm, rand, ...extra, vars,
    caps: (k) => (k.includes('.') ? THINGS[k.split('.')[0]]?.caps?.[k.split('.')[1]] : t?.caps?.[k]),
    log: (tpl, star) => hooks.log(who || 'town', thingId ? areaOf(W, thingId) : extra.area || 'square', fill(tpl, W.things[thingId], NAMES, words()), star),
    episode: (e, logTpl) => {
      W.episodes.push({ id: `e${++W.seq}`, at: Date.now(), day: dayOf(gm), t: hm(gm), title: fill(e.title || logTpl || t?.name || '', W.things[thingId], NAMES, words()), who: who && who !== 'town' ? [who] : [], thing: thingId, w: e.w || 1, drawn: false });
      if (W.episodes.length > 200) W.episodes.splice(0, W.episodes.length - 200);
    },
    refresh: ([lo, hi]) => refreshCommissions(W, gm, lo + Math.floor(rand() * (hi - lo + 1))),
    give: (k, n) => { if (who && who !== 'town') addItem(W, who, k, n); },
    eatbag: () => { if (who && who !== 'town') eatFromBag(W, who); }, // 喂猫：用掉随身带的一份吃的
    parcel: (to) => { if (who && who !== 'town' && CHARS[to]) hooks.parcel?.(who, to); },
    book: () => hooks.book?.(extra.vars?.title, extra.project),
  };
  return ctx;
}
export { ctxFor };

function refreshCommissions(W, gm, n) {
  const board = W.things.cboard; if (!board) return;
  const rand = seeded(`c${dayOf(gm)}`), open = (board.list || []).filter((c) => c.status === 'open' && dayOf(gm) - c.day < 2);
  const pool = NPCS.requests.filter((r) => PLACES[r.place] && !open.some((c) => c.tpl === r.id));
  for (let i = 0; i < n && pool.length; i++) {
    const total = pool.reduce((a, r) => a + (r.w || 1), 0);
    let x = rand() * total, k = 0;
    while (k < pool.length - 1 && (x -= pool[k].w || 1) > 0) k++;
    const r = pool.splice(k, 1)[0];
    open.push({ cid: `c${++W.seq}`, tpl: r.id, npc: NPCS.npcs[r.npc] || r.npc, text: r.text, place: r.place, act: r.act, minutes: r.minutes, done: r.done, end: r.end, status: 'open', day: dayOf(gm) });
  }
  board.list = open.slice(-4);
}

// 世界自己的钟：计时器、被动变化、每日定点、每天 05:00 的天气
export function worldClock(W, gm, hooks) {
  if (gm - W.clock < 1) return;
  W.clock = Math.floor(gm);
  const d = dayOf(gm), mod = gm % 1440;
  if (W.weather.day !== d && mod >= 300) {
    const today = forcedWeather(d) || W.weather.tomorrow || rollWeather(W.weather.today, `w${d}`);
    W.weather = { day: d, today, tomorrow: weatherFor(d + 1, today), rain: WEATHER.rainHours[(d * 7) % WEATHER.rainHours.length] };
    if (today !== 'clear') hooks.log('town', 'square', `今天${weatherName(today)}${today === 'rain' ? `（${W.weather.rain[0]}点到${W.weather.rain[1]}点）` : ''}`);
  }
  for (const [id, t] of Object.entries(THINGS)) {
    const s = W.things[id], get = getter(W, id, gm);
    for (const tm of t.timers || []) {
      if (cond(tm.when, get) && s[tm.at] > 0 && gm >= s[tm.at]) apply(tm, ctxFor(W, id, 'town', gm, hooks));
    }
    (t.passive || []).forEach((p, i) => {
      const key = `${id}.${i}`, last = W.passive[key] ?? gm;
      if (gm - last < p.every) { W.passive[key] = last; return; }
      W.passive[key] = gm;
      if (cond(p.when, get)) apply(p, ctxFor(W, id, 'town', gm, hooks, { hours: p.every / 60 }));
    });
    (t.daily || []).forEach((p, i) => {
      const key = `${id}.${i}`, at = parseAt(p.at), today = mod >= at ? d : d - 1;
      if ((W.daily[key] ?? today - 1) >= today) return;
      W.daily[key] = today;
      if (W.daily[key] === today && cond(p.when, get)) apply(p, ctxFor(W, id, 'town', gm, hooks));
    });
  }
}

// 动作开始 / 结束时的结算
export function startVerb(W, seg, gm, hooks) {
  const v = THINGS[seg.thing]?.verbs?.[seg.verb];
  if (v?.start) apply(v.start, ctxFor(W, seg.thing, seg.who, gm, hooks, { text: seg.text }));
}
export function settleVerb(W, seg, gm, hooks) {
  const t = THINGS[seg.thing], hours = (seg.t1 - seg.t0) / 60000 * 8 / 60;
  if (seg.cid) { // 街坊委托：完成后记一笔，有的还有谢礼
    const c = (W.things.cboard?.list || []).find((x) => x.cid === seg.cid);
    if (c && c.status === 'open') {
      c.status = 'done'; c.by = seg.who;
      const text = fill(c.done, {}, NAMES, { who: NAMES[seg.who] });
      hooks.log(seg.who, PLACES[c.place]?.area || 'market', text);
      W.episodes.push({ id: `e${++W.seq}`, at: Date.now(), day: dayOf(gm), t: hm(gm), title: text, who: [seg.who], thing: 'cboard', w: 2, drawn: false });
      if (c.end) apply(c.end, ctxFor(W, 'cboard', seg.who, gm, hooks, { area: PLACES[c.place]?.area }));
    }
    return;
  }
  const v = t?.verbs?.[seg.verb];
  if (!v) return;
  const ctx = ctxFor(W, seg.thing, seg.who, gm, hooks, { text: seg.text, hours });
  if (t.text) ctx.W.things[seg.thing].seen = { ...(W.things[seg.thing].seen || {}), [seg.who]: W.things[seg.thing].ver || 0 };
  apply(v.end, ctx);
  const s = W.things[seg.thing];
  s.ms = s.ms || [];
  (v.milestone || []).forEach((m, i) => {
    if (!s.ms.includes(i) && cond(m.when, getter(W, seg.thing, gm))) { s.ms.push(i); apply(m, ctx); }
  });
  if (v.cooldown) { W.cool[seg.who] = { ...(W.cool[seg.who] || {}), [`${seg.thing}.${seg.verb}`]: gm + v.cooldown }; }
}

// 念头和日记里的「梗」计数，比如 DeepSeek 又说了一次「明天再堆」
export function noteText(W, who, text) {
  for (const [id, t] of Object.entries(THINGS)) for (const [field, c] of Object.entries(t.counters || {})) {
    if (c.who === who && new RegExp(c.match).test(text)) W.things[id][field] = (+W.things[id][field] || 0) + 1;
  }
}

// 这个人此刻能对哪些物件做哪些动作（菜单的候选）
export function verbCandidates(W, gm, who, stats, busy) {
  const out = [];
  const extra = { ...stats, bagfood: bagCount(W, who, (it) => ITEMS[it.k]?.food), fish: bagCount(W, who, (it) => it.k === 'fish') };
  for (const [id, t] of Object.entries(THINGS)) {
    const owner = ownerOf(id), get = getter(W, id, gm, extra), place = placeOf(W, id);
    if (!PLACES[place]) continue;
    for (const [vk, v] of Object.entries(t.verbs || {})) {
      if (v.who === 'owner' && owner !== who) continue;
      if (v.who === 'guest' && owner === who) continue;
      if (v.who && !['owner', 'guest', 'any'].includes(v.who) && v.who !== who) continue;
      if (!cond(v.need, get)) continue;
      if ((W.cool[who]?.[`${id}.${vk}`] || 0) > gm) continue;
      if ((busy[id] || 0) >= (v.slots || 2)) continue;
      out.push({ kind: 'thing', thing: id, verb: vk, place, act: v.act, label: fill(v.label, W.things[id], NAMES, extrasFor(W, id)), minutes: v.minutes, writes: v.writes || 0, w: v.w || 1, tags: [...(t.tags || []), ...(v.tags || [])], owner });
    }
  }
  for (const c of (W.things.cboard?.list || []).filter((x) => x.status === 'open')) {
    out.push({ kind: 'commission', cid: c.cid, place: c.place, act: c.act, label: `${c.npc}的委托：${c.text}`, minutes: [c.minutes, c.minutes], w: 2, tags: ['errands'] });
  }
  return out;
}

// 给模型看的「世界此刻」：她所在区域和她自己店里的物件，以及她还没看过的新文字
export function worldLines(W, gm, who, area, limit = 5) {
  const lines = [], home = CHARS[who].home;
  for (const [id, t] of Object.entries(THINGS)) {
    const mine = ownerOf(id) === who, here = areaOf(W, id) === area;
    const unseen = t.text && (W.things[id].ver || 0) > (W.things[id].seen?.[who] ?? -1) && (W.things[id].ver || 0) > 0;
    if (mine || unseen || (here && PLACES[placeOf(W, id)]?.inside !== home)) lines.push({ p: mine ? 0 : unseen ? 1 : 2, text: `${t.name}：${showText(W, id)}${unseen ? '（有新内容，你还没看）' : ''}` });
  }
  return lines.sort((a, b) => a.p - b.p).slice(0, limit).map((x) => `- ${x.text}`);
}

// 页面要的：每个物件的说明和状态（状态用来在地图上画进度、灯笼、猫在哪儿……）
export function worldSnapshot(W) {
  return {
    weather: { today: W.weather.today, name: weatherName(W.weather.today), rain: W.weather.rain },
    things: Object.fromEntries(Object.entries(THINGS).map(([id, t]) => {
      const { seen, ms, ...state } = W.things[id] || {};
      return [id, { name: t.name, show: showText(W, id), page: t.page || [], place: placeOf(W, id), area: areaOf(W, id), at: PLACES[placeOf(W, id)]?.at, state }];
    })),
    commissions: (W.things.cboard?.list || []).map(({ cid, npc, text, status, by }) => ({ cid, npc, text, status, by })),
  };
}
export const areaName = (a) => AREAS[a]?.name || a;
