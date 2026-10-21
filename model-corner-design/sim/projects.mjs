// 项目：要做好几天的事（Claude 写新短篇、DeepSeek 试做新菜、GPT 画星图）。内容在 content/projects.json。
// 每一步是菜单里的一个选项；第一步起名字，之后每一步写下的那句话都会留下来（新书的段落、星图上的星）。
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { apply, cond, fill, seeded } from './rules.mjs';
import { PLACES } from './world.mjs';
import { CHARS } from './personas.mjs';

const read = (f) => JSON.parse(readFileSync(fileURLToPath(new URL(`./content/${f}`, import.meta.url)), 'utf8'));
export const PROJECTS = read('projects.json');
const dayOf = (gm) => Math.floor(gm / 1440);
export const clean = (s, n) => String(s || '').replace(/[《》「」"]/g, '').trim().slice(0, n).replace(/^[，。、！？,.!?\s]+|[，。、！？,.!?\s]+$/g, ''); // 题目两头不留标点

export const activeProject = (W, kind) => (W.projects || []).find((x) => x.kind === kind && x.status === 'active');

// 她现在能推进的项目，作为菜单的额外选项
export function projectOptions(W, id, gm, get) {
  W.projects ??= [];
  const out = [];
  for (const [kind, p] of Object.entries(PROJECTS)) {
    if (p.owner !== id || !cond(p.need, get)) continue;
    const cur = activeProject(W, kind);
    if (cur && gm - (cur.last ?? -1e9) < (p.cooldown || 0)) continue;
    if (!cur && W.projects.some((x) => x.kind === kind && x.status === 'done' && dayOf(gm) - x.endDay < 1)) continue; // 刚做完一个，歇一天再开新的
    const st = cur ? p.step : p.start;
    out.push({ kind: 'project', proj: kind, place: p.place, act: p.act, label: fill(st.label, { title: cur?.title || '' }, {}), minutes: p.minutes, writes: st.writes || 0, w: cur ? 2.5 : 1.3, tags: p.tags || [] });
  }
  return out;
}

// 一步做完时结算。hooks: { log(who, area, text, star), episode(e), useItem(who, k), ctx(project, vars) }
export function projectStep(W, seg, gm, hooks) {
  const p = PROJECTS[seg.proj]; if (!p) return;
  W.projects ??= [];
  const area = PLACES[p.place]?.area || 'square', who = p.owner, words = (x) => ({ title: x.title });
  let cur = activeProject(W, seg.proj);
  if (p.use && !hooks.useItem(who, p.use)) return; // 材料不够（比如鱼被吃掉了）
  if (!cur) {
    const title = clean(seg.text, 12) || `${p.name}${(W.projects.filter((x) => x.kind === seg.proj).length || 0) + 1}`;
    cur = { pid: `p${++W.seq}`, kind: seg.proj, owner: who, title, done: 0, steps: p.steps, parts: [], fails: 0, status: 'active', day: dayOf(gm) };
    W.projects.push(cur);
    if (p.start.log) hooks.log(who, area, fill(p.start.log, words(cur), {}));
  } else if (seg.text) cur.parts.push({ day: dayOf(gm), text: clean(seg.text, 40) });
  cur.last = gm;
  if (p.fail && cur.done > 0 && seeded(`${cur.pid}|${cur.done}|${cur.fails}`)() < p.fail) { // 试做失败：这一步不算数
    cur.fails++;
    const lines = p.failLog || [];
    if (lines.length) hooks.log(who, area, fill(lines[cur.fails % lines.length], words(cur), {}));
    if (cur.fails === 1) hooks.episode({ title: fill(lines[0] || `${p.name}失败了`, words(cur), {}), who: [who], w: 2 });
    return;
  }
  cur.done++;
  if (cur.done < cur.steps) return;
  cur.status = 'done'; cur.endDay = dayOf(gm);
  apply(p.done, hooks.ctx(cur, { title: cur.title }));
}

// 「你的事」里的一行：手上的项目做到哪了；做完的项目变成一行「会做的菜」「写完的书」
export function projectLines(W, id) {
  const out = [];
  for (const [kind, p] of Object.entries(PROJECTS)) {
    if (p.owner !== id) continue;
    const cur = activeProject(W, kind), done = (W.projects || []).filter((x) => x.kind === kind && x.status === 'done');
    if (cur) out.push(`- ${fill(p.doing, { title: cur.title }, {})}（做了 ${cur.done}/${cur.steps}${cur.parts.length ? `，上次写到：「${cur.parts.at(-1).text}」` : ''}）`);
    if (done.length) out.push(`- ${p.skill.replace(/（还没有）$/, '')}${p.skill.endsWith('（还没有）') ? '' : '、'}${done.map((x) => (kind === 'recipe' ? x.title : `《${x.title}》`)).join('、')}`);
  }
  return out;
}

// 给页面的：每个项目的进度
export function projectSnapshot(W) {
  return (W.projects || []).slice(-9).map(({ pid, kind, owner, title, done, steps, parts, status, fails }) => ({ pid, kind, owner, name: PROJECTS[kind]?.name, title, done, steps, parts: parts.slice(-5), status, fails, page: PROJECTS[kind]?.page || [] }));
}
export const projectDoing = (W, kind) => { const cur = activeProject(W, kind), p = PROJECTS[kind]; return cur ? fill(p.doing, { title: cur.title }, {}) : null; };
export const ownerName = (kind) => CHARS[PROJECTS[kind]?.owner]?.name;
