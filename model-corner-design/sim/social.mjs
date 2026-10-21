// 她们之间：随身物品（送、借、还）、请人帮忙、约人一起做事（多人活动）、羁绊（共同经历、梗、人情、约定）
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { cond } from './rules.mjs';
import { PLACES } from './world.mjs';
import { CHARS } from './personas.mjs';

const read = (f) => JSON.parse(readFileSync(fileURLToPath(new URL(`./content/${f}`, import.meta.url)), 'utf8'));
export const ITEMS = read('items.json'), GATHERINGS = read('gatherings.json');
const IDS = Object.keys(CHARS), name = (id) => CHARS[id]?.name || id;
const dayOf = (gm) => Math.floor(gm / 1440);
const parseHm = (x) => { const [h, mi] = String(x).split(':').map(Number); return h * 60 + mi; };
const hm = (gm) => `${String(Math.floor(gm / 60) % 24).padStart(2, '0')}:${String(Math.floor(gm % 60)).padStart(2, '0')}`;
export const pairKey = (a, b) => [a, b].sort().join('|');
// 两句话说的是不是同一件事：去掉名字、标点和虚字，看剩下的字重合了多少（按短的那句算）
const FILLER = new Set('帮我你她把陪一的了吧呀啊起去来给和再先好要会能请个这那些点下就也都还');
const chars = (t) => new Set([...String(t || '').replace(/DeepSeek|Claude|GPT/gi, '')].filter((ch) => /[\u4e00-\u9fff]/.test(ch) && !FILLER.has(ch)));
export function similar(a, b) {
  const x = chars(a), y = chars(b);
  if (!x.size || !y.size) return 0;
  let k = 0; for (const ch of x) if (y.has(ch)) k++;
  return k < 2 && Math.min(x.size, y.size) > 1 ? 0 : k / Math.min(x.size, y.size);
}

export function initSocial(W) {
  W.inv ??= {
    ds: [{ k: 'ledger', uid: 'i1', owner: 'ds' }],
    claude: [{ k: 'book', uid: 'i2', owner: 'claude' }],
    gpt: [{ k: 'starmap', uid: 'i3', owner: 'gpt' }],
  };
  for (const id of IDS) W.inv[id] ??= [];
  W.requests ??= []; W.gatherings ??= []; W.bonds ??= {};
  return W;
}

// ---------- 随身物品 ----------
export const itemName = (it) => it.name || ITEMS[it.k]?.name || it.k;
export const newUid = (W, p = 'i') => `${p}${++W.seq}`;
// 包裹里装的东西：送到收件人手里时拆开
const PARCEL = { ds: ['一大包海苔', '一袋新米', '一只鲸鱼形状的饭勺'], claude: ['一套新书签', '一瓶深蓝色墨水', '读者寄来的明信片'], gpt: ['一卷新星图纸', '一盒齿轮零件', '老同事寄来的一封信'] };
export function invText(W, id, you = '你') {
  const groups = {};
  for (const it of W.inv[id] || []) {
    const label = ITEMS[it.k]?.unique ? `${itemName(it)}${it.owner !== id ? `（${name(it.owner)}借给${you}的）` : ''}${it.loan ? `（借给了${name(it.loan)}）` : ''}` : itemName(it);
    if (it.loan) continue; // 借出去的不在手上
    groups[label] = (groups[label] || 0) + (it.n || 1);
  }
  const lent = (W.inv[id] || []).filter((it) => it.loan).map((it) => `${itemName(it)}（借给了${name(it.loan)}）`);
  return [...Object.entries(groups).map(([k, n]) => (n > 1 ? `${k}×${n}` : k)), ...lent];
}
export function addItem(W, id, k, n = 1) {
  if (!ITEMS[k] || !W.inv[id]) return;
  if (ITEMS[k].unique) return;
  const it = W.inv[id].find((x) => x.k === k && !x.uid);
  if (it) it.n = Math.min(12, (it.n || 1) + n); else W.inv[id].push({ k, n });
  W.inv[id] = W.inv[id].slice(-12);
}
const hasFood = (W, id) => (W.inv[id] || []).find((x) => ITEMS[x.k]?.food && (x.n || 1) > 0 && !x.uid);
export function eatFromBag(W, id) {
  const it = hasFood(W, id); if (!it) return null;
  it.n = (it.n || 1) - 1;
  if (it.n <= 0) W.inv[id] = W.inv[id].filter((x) => x !== it);
  return ITEMS[it.k];
}
export const bagFood = (W, id) => { const it = hasFood(W, id); return it ? itemName(it) : null; };

// 把东西交给身边的人：唯一的东西是借出 / 归还，其余是送
function matchItem(W, from, text) {
  const t = String(text || '').trim();
  return (W.inv[from] || []).find((it) => !it.loan && (it.k === t || t.includes(it.k) || itemName(it).includes(t.replace(/[《》]/g, '')) || t.includes(itemName(it).replace(/[《》]/g, ''))));
}
// 驿站的包裹到了某人手里：寄给她自己的当场拆开
export function takeParcel(W, who, to, hooks) {
  if (!W.inv[who] || !CHARS[to]) return;
  if (who === to) return openParcel(W, to, hooks);
  W.inv[who].push({ k: 'parcel', uid: newUid(W, 'p'), owner: who, to, name: `寄给${name(to)}的包裹` });
}
function openParcel(W, to, hooks) {
  const list = PARCEL[to] || ['一份小礼物'], what = list[(W.seq + to.length) % list.length];
  hooks.log(to, `${name(to)}拆开了寄给自己的包裹：是${what}`);
  hooks.episode({ title: `${name(to)}收到了${what}`, who: [to], w: 1 });
  return what;
}
export function give(W, from, to, text, hooks) {
  const it = matchItem(W, from, text) || (/包裹/.test(String(text)) && (W.inv[from] || []).find((x) => x.k === 'parcel')); if (!it || !W.inv[to]) return null;
  let line;
  if (it.k === 'parcel') { // 帮人取的包裹：交给收件人
    W.inv[from] = W.inv[from].filter((x) => x !== it);
    if (it.to === to) { const what = openParcel(W, to, hooks); line = `${name(from)}把包裹送到了${name(to)}手里，里面是${what}`; hooks.episode({ title: `${name(from)}给${name(to)}送包裹`, who: [from, to], w: 2 }); }
    else { W.inv[to].push({ ...it, owner: to }); line = `${name(from)}把${itemName(it)}交给了${name(to)}`; }
  } else if (ITEMS[it.k]?.unique) {
    if (it.owner === to) { // 还给主人
      W.inv[from] = W.inv[from].filter((x) => x !== it);
      const orig = W.inv[to].find((x) => x.uid === it.uid); if (orig) delete orig.loan;
      line = `${name(from)}把${itemName(it)}还给了${name(to)}`;
    } else if (it.owner === from && ITEMS[it.k].lend) { // 借出
      it.loan = to; W.inv[to].push({ k: it.k, uid: it.uid, owner: from, name: it.name, parts: it.parts });
      line = `${name(from)}把${itemName(it)}借给了${name(to)}`;
    } else return null;
  } else {
    it.n = (it.n || 1) - 1; if (it.n <= 0) W.inv[from] = W.inv[from].filter((x) => x !== it);
    addItem(W, to, it.k, 1);
    line = `${name(from)}送了${name(to)}一个${itemName(it)}`;
    const b = bond(W, from, to); if ((b.owe[from] || 0) > 0) b.owe[from]--; // 回礼抵一次人情
  }
  hooks.log(from, line);
  return line;
}

// ---------- 羁绊 ----------
export function bond(W, a, b) {
  const k = pairKey(a, b);
  W.bonds[k] ??= { shared: [], jokes: [], owe: {}, promises: [] };
  return W.bonds[k];
}
export function betweenLines(W, id, other, gm) {
  const b = W.bonds[pairKey(id, other)]; if (!b) return [];
  const out = [];
  const pr = b.promises.filter((p) => p.status === 'open' && dayOf(gm) - p.day <= 2);
  for (const p of pr.slice(-1)) out.push(p.by === id ? `你答应过${name(other)}：${p.text}` : `${name(other)}答应过你：${p.text}`);
  if ((b.owe[id] || 0) > 0) out.push(`你欠${name(other)} ${b.owe[id]} 次人情`);
  if ((b.owe[other] || 0) > 0) out.push(`${name(other)}欠你 ${b.owe[other]} 次人情`);
  const j = b.jokes.at(-1); if (j) out.push(`你们之间的梗：「${j.text}」`);
  const s = b.shared.at(-1); if (s) out.push(`一起经历过：${s.t}`);
  return out.slice(0, 2);
}
export function topics(W, id, other) {
  const b = W.bonds[pairKey(id, other)]; const out = [];
  if (b) {
    const p = b.promises.filter((x) => x.status === 'open').at(-1); if (p) out.push(p.text);
    const j = b.jokes.at(-1); if (j) out.push(`「${j.text}」`);
  }
  const lent = (W.inv[id] || []).find((it) => it.loan === other); if (lent) out.push(`借给她的${itemName(lent)}`);
  const req = W.requests.find((r) => r.status === 'accepted' && ((r.from === id && r.to === other) || (r.to === id && r.from === other))); if (req) out.push(req.text);
  return out.slice(0, 2);
}
export function addJoke(W, a, b, text, day) {
  const bd = bond(W, a, b), t = String(text || '').trim().slice(0, 16);
  if (!t || bd.jokes.some((j) => j.text === t)) return;
  bd.jokes.push({ text: t, by: a, day }); bd.jokes = bd.jokes.slice(-5);
}
export function addPromise(W, by, to, text, day) {
  const t = String(text || '').trim().slice(0, 20); if (!t) return;
  const bd = bond(W, by, to);
  if (bd.promises.some((p) => p.status === 'open' && p.by === by && similar(p.text, t) >= 0.6)) return; // 这件事已经答应过了
  if (W.requests.some((r) => r.to === by && r.from === to && r.status === 'accepted' && similar(r.text, t) >= 0.6)) return; // 已经记在「答应帮的忙」里
  bd.promises.push({ by, to, text: t, day, status: 'open' }); bd.promises = bd.promises.slice(-4);
}
export function addShared(W, ids, title, day) {
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const bd = bond(W, ids[i], ids[j]); bd.shared.push({ t: title, day }); bd.shared = bd.shared.slice(-8);
  }
}

// ---------- 请人帮忙 ----------
export function askFor(W, from, to, text, gm) {
  const t = String(text || '').trim().slice(0, 24); if (!t || from === to || !IDS.includes(to)) return null;
  // 同一个忙不反复求人：还在等回音、4 小时内刚请过，或者今天已经请她帮过差不多的事
  if (W.requests.some((r) => r.from === from && r.to === to && (['asked', 'accepted'].includes(r.status) || gm - (r.gm ?? r.day * 1440) < 240 || (r.day === dayOf(gm) && similar(r.text, t) >= 0.6)))) return null;
  const r = { rid: `r${Date.now().toString(36)}${Math.floor(gm)}`, from, to, text: t, status: 'asked', day: dayOf(gm), gm: Math.floor(gm) };
  W.requests.push(r); W.requests = W.requests.slice(-20);
  return r;
}
export function answerRequest(W, from, to, answer, hooks) {
  const r = W.requests.findLast?.((x) => x.from === from && x.to === to && x.status === 'asked') || [...W.requests].reverse().find((x) => x.from === from && x.to === to && x.status === 'asked');
  if (!r) return;
  r.status = /^y|答应|好|行|可以/i.test(String(answer || '')) ? 'accepted' : 'declined';
  if (r.status === 'accepted') hooks.log(to, `${name(to)}答应帮${name(from)}：${r.text}`);
}
export function finishRequest(W, rid, hooks, gm) {
  const r = W.requests.find((x) => x.rid === rid); if (!r || r.status !== 'accepted') return;
  r.status = 'done';
  const b = bond(W, r.from, r.to); b.owe[r.from] = (b.owe[r.from] || 0) + 1;
  hooks.rel?.(r.from, r.to, 2);
  for (const p of b.promises) if (p.status === 'open' && p.by === r.to && similar(p.text, r.text) >= 0.6) p.status = 'kept';
  const line = `${name(r.to)}帮${name(r.from)}${r.text.replace(/^帮我?/, '')}`;
  hooks.log(r.to, line);
  hooks.episode({ title: line, who: [r.to, r.from], w: 2 });
  addShared(W, [r.to, r.from], line, dayOf(gm));
}

// 没人回音的请求、拖了一天的忙、好几天前的约定，慢慢就淡了
export function socialTick(W, gm, hooks) {
  for (const r of W.requests) {
    const age = gm - (r.gm ?? r.day * 1440);
    if (r.status === 'asked' && age > 180) r.status = 'expired';
    else if (r.status === 'accepted' && age > 1440) r.status = 'dropped';
  }
  for (const b of Object.values(W.bonds)) for (const p of b.promises) {
    if (p.status !== 'open' || dayOf(gm) - p.day <= 2) continue;
    p.status = 'lapsed';
    hooks?.rel?.(p.to, p.by, -2);
    hooks?.episode?.({ title: `${name(p.by)}答应${name(p.to)}的事没做到：${p.text}`, who: [p.by, p.to], w: 1 });
  }
}

// ---------- 约人一起做事 ----------
export function gatheringKind(text) {
  const t = String(text || '');
  return Object.entries(GATHERINGS).find(([k, g]) => t.includes(k) || g.words.some((w) => t.includes(w)))?.[0] || null;
}
// "claude,gpt:meal@19:00" → 一次约会
export function invite(W, host, spec, gm, get, hooks) {
  const m = String(spec || '').match(/^\s*([^:：]+)[:：]\s*([^@]+?)\s*(?:@\s*(\d{1,2})[:：](\d{2}))?\s*$/);
  if (!m) return null;
  const who = m[1].split(/[,，、\s]+/).map((x) => IDS.find((id) => id === x.trim() || name(id) === x.trim())).filter((id) => id && id !== host);
  const kind = gatheringKind(m[2]); const g = GATHERINGS[kind];
  if (!who.length || !g || (g.need && !cond(g.need, get))) return null;
  let at = m[3] ? dayOf(gm) * 1440 + (+m[3]) * 60 + (+m[4]) : gm + 120;
  if (at < gm + 30) at += at < gm ? 1440 : 30;
  if (g.earliest && at % 1440 < parseHm(g.earliest)) at = Math.floor(at / 1440) * 1440 + parseHm(g.earliest); // 观星总得等天黑
  if (at - gm > 8 * 60) return null;
  if (W.gatherings.some((x) => x.kind === kind && ['planned', 'running'].includes(x.status) && Math.abs(x.at - at) < 120)) return null;
  const x = { gid: `g${Math.floor(gm)}${kind}`, kind, host, place: g.place, at, until: at + g.minutes, invited: who, present: [], status: 'planned', rounds: 0, lines: [] };
  W.gatherings.push(x); W.gatherings = W.gatherings.slice(-12);
  hooks.log(host, `${name(host)}约了${who.map(name).join('、')}，${hm(at)}在${PLACES[g.place].name.replace('（店里）', '')}${g.name}`);
  return x;
}
// 每周固定的活动（比如周五读书会）：当天早上贴出来
export function calendar(W, gm, weekday, hooks) {
  for (const [kind, g] of Object.entries(GATHERINGS)) {
    const wk = g.weekly; if (!wk || wk.weekday !== weekday) continue;
    const [ah, am] = wk.announce.split(':').map(Number), [h, mi] = wk.at.split(':').map(Number);
    const d = dayOf(gm), at = d * 1440 + h * 60 + mi;
    if (gm % 1440 < ah * 60 + am || gm > at || W.gatherings.some((x) => x.kind === kind && x.at === at)) continue;
    W.gatherings.push({ gid: `g${at}${kind}`, kind, host: wk.host, place: g.place, at, until: at + g.minutes, invited: IDS.filter((x) => x !== wk.host), present: [], status: 'planned', rounds: 0, lines: [], weekly: true, title: wk.name });
    hooks.log(wk.host, `${h < 17 ? '今天' : '今晚'} ${wk.at} ${PLACES[g.place].name.replace('（店里）', '')}有${wk.name || g.name}`, true);
  }
}
export const gatheringName = (x) => x.title || GATHERINGS[x.kind]?.name || x.kind;
export function myGatherings(W, id, gm) {
  return W.gatherings.filter((x) => ['planned', 'running'].includes(x.status) && x.until > gm && (x.host === id || x.invited.includes(id)) && !x.present.includes(id));
}
const roleOf = (x, id) => { const owner = IDS.find((k) => CHARS[k].home === GATHERINGS[x.kind].place); return id === owner || (!owner && id === x.host) ? 'owner' : 'other'; };
export const gatheringAct = (x, id) => GATHERINGS[x.kind].act[roleOf(x, id)];
export const gatheringDoing = (x, id) => GATHERINGS[x.kind].doing?.[roleOf(x, id)] || gatheringName(x);
export const gatheringAnim = (x, id) => GATHERINGS[x.kind].anim?.[roleOf(x, id)] || null;

// 「约人」的念头：gatherings.json 里每种活动的 ideas 写着谁、几点到几点之间会想到约谁；
// 合适的时候变成菜单里的一个选项（去找其中一个人当面约），约不约由她自己选
export function inviteIdeas(W, id, gm, get, awake) {
  const h = (gm % 1440) / 60, d = dayOf(gm), out = [];
  if (W.gatherings.some((x) => x.host === id && dayOf(x.at) === d)) return out; // 今天已经约过一次了
  for (const [kind, g] of Object.entries(GATHERINGS)) {
    if (g.need && !cond(g.need, get)) continue;
    if (W.gatherings.some((x) => x.kind === kind && dayOf(x.at) === d && x.status !== 'done')) continue;
    for (const idea of g.ideas || []) {
      if (idea.host !== id || h < idea.from || h >= idea.to) continue;
      const who = idea.with.filter((k) => k !== id), meet = who.filter((k) => awake.includes(k));
      if (!meet.length) continue;
      let at = idea.at.startsWith('+') ? Math.ceil((gm + +idea.at.slice(1)) / 10) * 10 : d * 1440 + parseInt(idea.at, 10) * 60 + +(idea.at.split(':')[1] || 0);
      if (at < gm + 30) continue;
      const rest = who.filter((k) => k !== meet[0]).map(name);
      out.push({ kind: 'talk', talk: meet[0], act: 'chat', invite: `${who.join(',')}:${kind}@${hm(at)}`, label: `去找${name(meet[0])}，约她${rest.length ? `和${rest.join('、')}` : ''}${hm(at)}${g.name}（${PLACES[g.place].name.replace('（店里）', '')}）`, minutes: [20, 30], w: idea.w || 2.5 });
    }
  }
  return out.slice(0, 1);
}
