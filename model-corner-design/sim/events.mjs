// 日程和意外：每周固定的日子（集市日、流星雨、灯笼节）和每天最多两件的小意外。内容在 content/calendar.json、incidents.json。
// 多人活动的日程（读书会、野餐会、流星雨观星会）在 gatherings.json 的 weekly 里，由 social.mjs 贴出来。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apply, cond, seeded } from './rules.mjs';

const read = (f) => JSON.parse(readFileSync(fileURLToPath(new URL(`./content/${f}`, import.meta.url)), 'utf8'));
export const CALENDAR = read('calendar.json'), INCIDENTS = read('incidents.json');
const dayOf = (gm) => Math.floor(gm / 1440);
const weekdayOf = (d) => ((d - 1) % 7 + 7) % 7 + 1;
const hm = (gm) => `${String(Math.floor(gm / 60) % 24).padStart(2, '0')}:${String(Math.floor(gm % 60)).padStart(2, '0')}`;
const parseAt = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
export const eventsOn = (d) => CALENDAR.filter((e) => e.weekly === weekdayOf(d));

// 这一天被日程定死的天气（流星雨那天一定是晴天）
export function forcedWeather(d) { return eventsOn(d).find((e) => e.force?.weather)?.force.weather || null; }
// 两天内有流星雨的话，GPT 的水晶球能看见
export function meteorAhead(gm) {
  const d = dayOf(gm);
  for (const k of [1, 2]) if (eventsOn(d + k).some((e) => e.forecast)) return { days: k };
  return null;
}
// 正在进行的日程（页面画流星、灯笼；提示词里写一句）
export function activeEvents(gm) {
  const d = dayOf(gm), mod = gm % 1440;
  return eventsOn(d).filter((e) => e.until && mod >= parseAt(e.at) && mod < parseAt(e.until)).map((e) => ({ id: e.id, name: e.name, until: e.until, area: e.area }));
}
export function todayEvents(gm) { return eventsOn(dayOf(gm)).map((e) => ({ id: e.id, name: e.name, at: e.at, until: e.until || null })); }

// 日程：到点开始、到点结束。ctx(area) 给出执行效果的上下文
export function calendarTick(W, gm, ctx, hooks) {
  const d = dayOf(gm), mod = gm % 1440;
  W.cal ??= {};
  for (const e of eventsOn(d)) {
    const at = parseAt(e.at), until = e.until ? parseAt(e.until) : 1440, st = (W.cal[e.id] ??= { day: -1, ended: -1 });
    if (st.day !== d && mod >= at && mod < until) {
      st.day = d;
      if (e.do) apply(e.do, ctx(e.area));
      if (e.log) hooks.log('town', e.area, e.log, !!e.star);
      W.episodes.push({ id: `e${++W.seq}`, at: Date.now(), day: d, t: hm(gm), title: e.name, who: [], w: e.star ? 2 : 1, drawn: false });
    }
    if (e.until && st.day === d && st.ended !== d && mod >= until) { st.ended = d; if (e.end) apply(e.end, ctx(e.area)); }
  }
}

// 意外：每天 05:00 掷出今天有几件（0～2 件）和发生的时间（9:00～19:00），到点时从当下说得通的意外里按权重挑一件
export function incidentTick(W, gm, get, ctx, hooks) {
  const d = dayOf(gm), mod = gm % 1440;
  if (W.inc?.day !== d && mod >= 300) {
    const r = seeded(`inc${d}`), u = r(), n = u < 0.3 ? 0 : u < 0.75 ? 1 : 2;
    W.inc = { day: d, at: Array.from({ length: n }, () => 540 + Math.floor(r() * 600)).sort((a, b) => a - b), fired: [], used: [] };
  }
  if (!W.inc || W.inc.day !== d) return;
  W.inc.at.forEach((at, i) => {
    if (W.inc.fired.includes(i) || mod < at) return;
    W.inc.fired.push(i);
    const pool = INCIDENTS.filter((x) => !W.inc.used.includes(x.id) && cond(x.when, get));
    if (!pool.length) return;
    const r = seeded(`inc${d}.${i}`)(), total = pool.reduce((a, x) => a + (x.w || 1), 0);
    let acc = 0, x = pool[pool.length - 1];
    for (const p of pool) { acc += (p.w || 1) / total; if (r < acc) { x = p; break; } }
    W.inc.used.push(x.id);
    if (x.do) apply(x.do, ctx(x.area));
    hooks.log('town', x.area, x.log, false);
    if (x.episode) W.episodes.push({ id: `e${++W.seq}`, at: Date.now(), day: d, t: hm(gm), title: x.episode.title || x.log, who: [], w: x.episode.w || 1, drawn: false });
  });
}
