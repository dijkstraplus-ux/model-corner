// 「现在能做的」：从世界状态里挑出和她此刻最相关的几件事，编号给模型选（分数不给模型看）
import { seeded } from './rules.mjs';
import { PLACES, ACTIVITIES } from './world.mjs';
import { CHARS } from './personas.mjs';
import { verbCandidates } from './worldstate.mjs';

// 人设偏好：和物件、动作的标签对上就加一点分
const LIKES = { ds: ['food', 'beach', 'play'], claude: ['books', 'writing', 'quiet'], gpt: ['errands', 'stars', 'repair'] };
// 没有物件的地方也能去：闲着、吃点东西、散步
const FREE = [['benchW', 'slack'], ['benchE', 'read'], ['fountain', 'rest'], ['tree', 'read'], ['pier', 'stargaze'], ['umbrella', 'rest'], ['fruit', 'eat'],
  ['snack', 'eat'], ['picnic', 'eat'], ['bridge', 'rest'], ['benchP', 'read'], ['beach', 'play'], ['shrine', 'pray'], ['jetty', 'rest'], ['flower', 'shop']];

export function buildMenu({ W, gm, id, c, pos, others, today, extras = [], talkTopics = {} }) {
  const h = (gm % 1440) / 60, day = Math.floor(gm / 1440), rand = seeded(`${day}|${id}|${Math.floor(gm / 30)}`);
  const busy = {};
  for (const o of others) if (o.thing) busy[o.thing] = (busy[o.thing] || 0) + 1;
  const stats = { food: c.stats.food, energy: c.stats.energy, mood: c.stats.mood };
  const cands = verbCandidates(W, gm, id, stats, busy);
  for (const [place, act] of FREE) {
    const p = PLACES[place];
    if (!p || !p.acts.includes(act)) continue;
    if (act === 'stargaze' && (h < 18 && h > 5)) continue;
    cands.push({ kind: 'free', place, act, label: `${ACTIVITIES[act].desc.split('、')[0]}`, minutes: [30, 90], w: 0.5, tags: act === 'eat' ? ['food'] : act === 'read' ? ['books', 'quiet'] : act === 'play' ? ['play'] : act === 'stargaze' ? ['stars'] : [] });
  }
  for (const o of others) {
    if (o.asleep || o.travel) continue;
    const tp = talkTopics[o.id] || [];
    cands.push({ kind: 'talk', talk: o.id, place: o.place, act: 'chat', label: `去找${CHARS[o.id].name}（她${o.where}，${o.doing}${tp.length ? `；可以聊：${tp.join('、')}` : ''}）`, minutes: [20, 40], w: 0.6 + (tp.length ? 0.6 : 0), tags: [] });
  }
  // 约好的事、答应别人的忙、随身带的吃的：由 sim 传进来，分数自带
  for (const e of extras) cands.push({ tags: [], minutes: [30, 60], w: 1, ...e });
  const todo = (W.todo[id] || []).filter((x) => x.day === day).map((x) => x.text);
  const likes = LIKES[id] || [];
  const doneToday = (key) => today.filter((x) => x.key === key).length;
  const recentPlaces = today.slice(-2).map((x) => x.place);
  for (const k of cands) {
    let s = k.w;
    const p = PLACES[k.place];
    if (todo.some((t) => [...new Set(t)].filter((ch) => k.label.includes(ch) && /[一-龥]/.test(ch)).length >= 2)) s += 3;
    if (k.kind === 'thing' && k.owner === id && h >= 7 && h < 21) s += 1;
    if (k.kind === 'commission' && id === 'gpt') s += 1.5;
    if (k.tags.some((t) => likes.includes(t))) s += 1;
    if (stats.food < 35 && k.act === 'eat') s += 4;
    if (stats.energy < 30 && (k.act === 'rest' || k.act === 'slack')) s += 3;
    if (stats.mood < 40 && k.act === 'play') s += 2;
    if (p && p.area !== pos.area) s -= 0.8;
    s -= 1.5 * doneToday(k.thing ? `${k.thing}.${k.verb}` : `${k.place}.${k.act}`);
    if (recentPlaces.length === 2 && recentPlaces.every((x) => x === k.place)) s -= 2;
    if (h >= 21 && k.act !== 'rest' && k.act !== 'chat' && k.act !== 'stargaze' && k.act !== 'read') s -= 1;
    k.score = s + rand() * 0.6;
  }
  cands.sort((a, b) => b.score - a.score);
  // 多样性：同一个地方最多 3 个；保证有别的区域、有一个闲着的、有人醒着就有一个找人的
  const pick = [], perPlace = {};
  const take = (k) => { if (!k || pick.includes(k) || pick.length >= 7) return; pick.push(k); perPlace[k.place] = (perPlace[k.place] || 0) + 1; };
  for (const k of cands) if ((perPlace[k.place] || 0) < 3 && pick.length < 5) take(k);
  take(cands.find((k) => !pick.includes(k) && PLACES[k.place]?.area !== pos.area));
  take(cands.find((k) => !pick.includes(k) && k.kind === 'free' && ['slack', 'rest'].includes(k.act)));
  take(cands.find((k) => !pick.includes(k) && k.kind === 'talk'));
  for (const k of cands) take(k);
  return pick.slice(0, 7).map((k, i) => ({ ...k, key: `o${i + 1}`, line: `o${i + 1} ${PLACES[k.place]?.name || k.place}·${k.label}${k.writes ? `（要写下${k.writes}字以内的内容）` : ''}` }));
}
