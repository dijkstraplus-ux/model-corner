// 每小时漫画：把这段时间街上发生的事和角色之间的故事，交给 deepseek 写成四格分镜，再用 gpt-image-2 画出来
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chat, image, parseJson } from './llm.mjs';
import { CHARS } from './personas.mjs';
import { THINGS, showText, weatherName } from './worldstate.mjs';

const DATA = process.env.SIM_DATA || fileURLToPath(new URL('./data/', import.meta.url));
export const COMIC_DIR = `${DATA}comics/`;
const INDEX = `${DATA}comics.json`, CALLS = `${DATA}calls.jsonl`;

// 角色外貌：和游戏里精灵图的描述保持一致
const LOOK = {
  ds: 'DeepSeek：鲸鱼娘。深蓝渐变到浅蓝的蓬松长卷发，头顶一根卷曲呆毛；头两侧一对蓝白色鲸鳍状耳朵（没有普通人耳）；白色褶边女仆头箍，头侧浅蓝小蝴蝶结；大而圆的蓝眼睛，淡淡腮红。深蓝女仆装配蓬袖，白色褶边围裙上有小鲸鱼图案，黑色领结配蓝宝石；白裤袜、深蓝玛丽珍鞋；身后一条深蓝鲸鱼尾巴，末端双叶尾鳍。',
  claude: 'Claude：铜橙色长直发的人类少女，发尾柔和波浪，长及膝盖；头侧一朵大大的橙金色多瓣放射状花饰，花下黑色蝴蝶结、奶油色短飘带和金色小流苏；暖琥珀色眼睛，安静温柔。奶油白高领褶边衬衣配橙色小花胸针，奶油白长裙两侧有黑色镶金边裙片；常抱着一本黑色封皮、金色放射徽记的书。没有兽耳、角、翅膀或尾巴。',
  gpt: 'GPT：银白发龙娘。银白色蓬松长发带淡紫阴影，头顶一根呆毛；一对浅象牙色弯曲龙角、尖耳；淡紫色眼睛，从容带点得意。背后一对淡紫色膜翼，身后一条白色鳞质龙尾。白色立领露肩连衣长裙，宽大长垂袖；头侧银色交织圆结饰物和小流苏。',
};

// 画风：可爱呆萌、简单随意，不追求精致
const STYLE = `画风：可爱呆萌的简笔小漫画，像随手画的表情包涂鸦，故意画得简单、不精致。角色是 2 头身的软萌团子：大圆脑袋、豆豆眼、圆脸蛋上两团腮红、小短手小短腿，头发画成几大块简单的色块，不画发丝细节；表情夸张好懂（冒汗、星星眼、嘴巴张成圆形、哭成两条小瀑布），配简单的漫画符号（汗滴、小花、波浪线、闪光、问号）。线条少而圆润、略带手绘抖动，平涂上色、颜色柔和明亮、不画阴影和高光；背景只用几笔线条和一两块色块示意地点，大量留白，不要复杂场景、不要细节堆砌、不要写实光影。`;

export function loadComics() {
  return existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : [];
}

// state：sim 的状态（读 state.json 或运行中的 S）；from/to：现实时间（毫秒）
export async function makeComic(state, from, to, cfg) {
  const inWin = (x) => x.at >= from && x.at < to;
  const log = state.log.filter(inWin);
  if (log.length < 2) return null; // 这段时间几乎没发生什么，不画
  const thoughts = Object.entries(state.chars).flatMap(([id, c]) => c.thoughts.filter(inWin).map((x) => ({ ...x, who: id })))
    .sort((a, b) => a.at - b.at).slice(-24);
  // 事件簿：这段时间里值得画的小故事（送东西、帮忙、一起吃饭……），按分量挑；画过的不再画
  const eps = (state.world?.episodes || []).filter((e) => !e.drawn && e.at >= from && e.at < to).sort((a, b) => b.w - a.w).slice(0, 10).sort((a, b) => a.at - b.at);
  const drawnBefore = loadComics().slice(-3).map((c) => `《${c.title}》`).join('');
  // 画面里可以出现的道具：和世界里此刻的样子一致（事件簿提到的物件，加上几样一直在的）
  const W = state.world, props = W ? [...new Set([...eps.map((e) => e.thing).filter(Boolean), 'sandcastle', 'blackboard', 'counter', 'cat'])].filter((id) => THINGS[id] && W.things[id]).slice(0, 6).map((id) => `${THINGS[id].name}：${showText(W, id)}`) : [];
  if (W?.weather) props.unshift(`天气：${weatherName(W.weather.today)}`);
  const day0 = log[0].day, t0 = log[0].t, t1 = log[log.length - 1].t;
  const user = `这一段时间：第 ${day0} 天 ${t0} 到 ${t1}。
街区日志（按时间）：
${log.map((e) => `- ${e.t} ${e.text}`).join('\n')}
${eps.length ? `这段时间的小故事（事件簿，★ 越多越值得画）：\n${eps.map((e) => `- [${e.id}] ${e.t} ${'★'.repeat(Math.min(3, e.w))} ${e.title}${(e.lines || []).length ? `（${e.lines.slice(-4).map(([w, l]) => `${CHARS[w]?.name || w}：「${l}」`).join(' ')}）` : ''}`).join('\n')}\n` : ''}角色们心里想的：
${thoughts.map((x) => `- ${x.t} ${CHARS[x.who].name}：${x.text}`).join('\n') || '（无）'}${props.length ? `\n画面里可以出现的道具（要和世界一致）：\n${props.map((x) => `- ${x}`).join('\n')}` : ''}${drawnBefore ? `\n最近已经画过：${drawnBefore}（别再画同一件事）` : ''}
角色：DeepSeek（鲸鱼娘，深海食堂老板，贪吃爱摸鱼，口头禅「服务器繁忙」）、Claude（纸页书屋店主，温柔细心的完美主义者）、GPT（白龙，星仪万事屋主人，自信热心爱说「顺便」）。`;
  const system = `你是《鲸巷》的绘本编辑。看这段时间真实发生的事，决定要不要画、画成什么：
- "comic"：有前因后果、能串成一个小故事的几件事 → 一页四格漫画，像一段有故事性的回忆。
- "cg"：有一个特别亮眼、动人或好笑的瞬间（比如一次暖心的对话、一个新成就、一个大失误）→ 一张单幅插画，定格这个高光时刻。
- "none"：只是平平常常的日常，没有值得画的 → 不画。不要勉强。
要求：DeepSeek 是主角（漫画每一格都有她，CG 里她在画面中心）；只用日志、事件簿和念头里真实发生过的事，不要编造；优先画事件簿里 ★ 多的事（角色之间的互动最好看）；台词口语、短，符合各自性格。
只输出 JSON：
{"kind": "comic" | "cg" | "none",
 "reason": "为什么这样选（≤30字）",
 "title": "标题（≤12字）",
 "uses": ["画到的事件簿编号，如 e12；没用事件簿就空数组"],
 "panels": [{"scene": "这一格的画面：地点、动作、表情（≤60字）", "who": ["ds", ...], "lines": [{"who": "ds", "text": "台词（≤14字）"}], "caption": "旁白（≤14字）或空字符串"}],
 "cg": {"scene": "这一刻的画面：地点、光线氛围、每个人的动作和表情（≤90字）", "who": ["ds", ...]}}
kind 是 comic 时 panels 正好 4 个、每格台词最多 2 句；kind 是 cg 时只填 cg；kind 是 none 时只填 kind 和 reason。`;
  const messages = [{ role: 'system', content: system }, { role: 'user', content: user }];
  const r = await chat({ model: cfg.models?.ds || cfg.model, messages, maxTokens: 1200, temperature: 0.9, reasoning: cfg.reasoning, json: true });
  appendFileSync(CALLS, JSON.stringify({ at: new Date().toISOString(), char: 'ds', kind: 'comic-script', ms: r.ms, usage: r.usage, messages, reply: r.text }) + '\n');
  const script = parseJson(r.text);
  const kind = ['comic', 'cg'].includes(script.kind) ? script.kind : 'none';
  if (kind === 'none') return { kind, reason: String(script.reason || '').slice(0, 40) };
  const panels = kind === 'comic' ? (script.panels || []).slice(0, 4) : [];
  if (kind === 'comic' && panels.length < 4) throw new Error('comic script has fewer than 4 panels');
  const who = kind === 'comic' ? panels.flatMap((p) => p.who || []) : script.cg?.who || [];
  const cast = [...new Set(['ds', ...who])].filter((id) => LOOK[id]);
  const name = (id) => CHARS[id]?.name || id;
  const castText = `角色（画成简化的团子版，发色、标志性配饰和配色要认得出来、前后一致）：\n${cast.map((id) => `- ${LOOK[id]}`).join('\n')}`;
  const prompt = kind === 'comic' ? `一页竖版四格漫画：四个大小相同的横向画格从上到下排列，简单的黑色手绘边框，白色格间距；最上方是手写的标题「${script.title}」。

${STYLE}

${castText}

${panels.map((p, i) => `第 ${i + 1} 格：${p.scene}${(p.lines || []).length ? `\n  对白气泡：${p.lines.slice(0, 2).map((l) => `${name(l.who)}说「${l.text}」`).join('；')}` : ''}${p.caption ? `\n  方形旁白框：「${p.caption}」` : ''}`).join('\n')}

文字要求：对白气泡和旁白框里只写上面给出的中文，字清晰、正确；气泡尾巴指向说话的人；不要其他文字、水印或签名。` : `一张横幅插画（CG），定格一个高光时刻：${script.cg.scene}

${STYLE}

${castText}

画面里不要出现任何文字、对白气泡、水印或签名。DeepSeek 在画面视觉中心。`;
  const img = await image({ prompt, size: kind === 'comic' ? '1024x1536' : '1536x1024', quality: 'medium' });
  appendFileSync(CALLS, JSON.stringify({ at: new Date().toISOString(), char: 'ds', kind: `${kind}-image`, ms: img.ms, usage: img.usage, prompt }) + '\n');
  mkdirSync(COMIC_DIR, { recursive: true });
  const id = `c${to}`;
  writeFileSync(`${COMIC_DIR}${id}.png`, img.png);
  const uses = (Array.isArray(script.uses) ? script.uses : []).filter((u) => eps.some((e) => e.id === u));
  for (const e of eps) if (uses.includes(e.id)) e.drawn = true; // state 是运行中的 S 时，下次存盘就记住了
  const entry = { id, kind, at: to, from, day: day0, span: `${t0}–${t1}`, title: String(script.title || '').slice(0, 20), reason: String(script.reason || '').slice(0, 40), uses, panels, cg: kind === 'cg' ? script.cg : undefined, file: `${id}.png` };
  const list = loadComics();
  list.push(entry);
  writeFileSync(`${INDEX}.tmp`, JSON.stringify(list));
  renameSync(`${INDEX}.tmp`, INDEX);
  return entry;
}
