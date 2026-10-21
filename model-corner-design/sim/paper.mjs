// 鲸巷日报：每个游戏日结束后，把这一天真实发生的事写成一份小报。只给观众看，角色不会读到。
import { appendFileSync, existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chat, parseJson } from './llm.mjs';
import { CHARS } from './personas.mjs';

const DATA = process.env.SIM_DATA || fileURLToPath(new URL('./data/', import.meta.url));
const INDEX = `${DATA}papers.json`, CALLS = `${DATA}calls.jsonl`;

export function loadPapers() {
  return existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : [];
}

// log：这一天的街区日志（含归档）；diaries：{ id: {mood, text} }；comics：这一天画好的漫画标题
export async function makePaper({ day, log, diaries, thoughts, comics }, cfg) {
  if (log.length < 3) return null;
  const user = `第 ${day} 天的街区日志（按时间）：
${log.map((e) => `- ${e.t} ${e.text}`).join('\n')}
三位居民当天的日记：
${Object.entries(diaries).map(([id, d]) => `- ${CHARS[id].name}（心情：${d.mood || '未写'}）：${d.text}`).join('\n') || '（还没写）'}
她们当天的一些念头：
${thoughts.map((x) => `- ${x.t} ${CHARS[x.who].name}：${x.text}`).join('\n') || '（无）'}
${comics.length ? `当天画成漫画的故事：${comics.join('、')}` : ''}`;
  const system = `你是海边小镇「鲸巷」的小报《鲸巷日报》的编辑，每天早上把前一天街上真实发生的事写成一份小报。
居民：DeepSeek（鲸鱼娘，深海食堂老板）、Claude（纸页书屋店主）、GPT（白龙，星仪万事屋主人）。
要求：
- 只写日志、日记、念头里真实发生过的事，不编造事件、数字和人物；可以加一点俏皮的小报口吻。
- 头条选当天最有故事性的一件事；其他文章挑两三件不同的事。
- 不要提到模型、AI、提示词。
只输出 JSON：
{"headline": "头条标题（≤16字）",
 "lead": "头条正文（80～140字）",
 "articles": [{"title": "标题（≤14字）", "body": "正文（50～100字）", "tag": "栏目（如：食堂动态 / 书屋近况 / 万事屋委托 / 街头巷尾）"}],
 "quote": {"who": "ds 或 claude 或 gpt", "text": "当天她说过或想过的一句话（照原话）"},
 "tomorrow": "明日看点：根据她们的打算写一句（≤30字）"}
articles 2～3 篇。`;
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  const r = await chat({ model: cfg.models?.ds?.includes(':') ? cfg.model : cfg.models?.ds || cfg.model, messages, maxTokens: 1500, temperature: 0.8, reasoning: cfg.reasoning, json: true });
  appendFileSync(CALLS, JSON.stringify({ at: new Date().toISOString(), char: 'town', kind: 'paper', ms: r.ms, usage: r.usage, messages, reply: r.text }) + '\n');
  const p = parseJson(r.text);
  const cut = (s, n) => (typeof s === 'string' ? s.trim().slice(0, n) : '');
  const paper = {
    day, at: Date.now(),
    headline: cut(p.headline, 24), lead: cut(p.lead, 260),
    articles: (Array.isArray(p.articles) ? p.articles : []).slice(0, 3).map((a) => ({ title: cut(a.title, 20), body: cut(a.body, 200), tag: cut(a.tag, 10) })).filter((a) => a.title && a.body),
    quote: p.quote && CHARS[p.quote.who] ? { who: p.quote.who, text: cut(p.quote.text, 60) } : null,
    tomorrow: cut(String(p.tomorrow || '').replace(/^\s*明日看点\s*[:：]\s*/, ''), 50),
  };
  if (!paper.headline || !paper.lead) throw new Error('paper without headline');
  const list = loadPapers().filter((x) => x.day !== day);
  list.push(paper);
  list.sort((a, b) => a.day - b.day);
  writeFileSync(`${INDEX}.tmp`, JSON.stringify(list));
  renameSync(`${INDEX}.tmp`, INDEX);
  return paper;
}
