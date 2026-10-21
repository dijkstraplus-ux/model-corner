// 世界：区域、区域之间的路口、地点、活动。坐标都是地图坐标（1536×1024）
import { fileURLToPath } from 'node:url';
import { loadGrid, nearestWalkable, center } from './nav.mjs';

const NAV = (a) => fileURLToPath(new URL(`../nav/${a}.json`, import.meta.url));

export const AREAS = {
  square: { name: '鲸巷广场' },
  market: { name: '海边集市' },
  park: { name: '后山公园' },
};
for (const [k, a] of Object.entries(AREAS)) a.grid = loadGrid(NAV(k));

// 路口：从一个区域的边上走出去，过一会儿出现在另一个区域的边上
export const LINKS = [
  { a: 'square', at: [742, 30], b: 'park', bt: [1000, 1015] },
  { a: 'square', at: [12, 365], b: 'market', bt: [110, 22] },
];
export const TRAVEL_SEC = 40; // 区域之间路上的现实秒数（画面外）

export const SHOPS = {
  diner: { name: '深海食堂', owner: 'ds', area: 'square', door: [395, 335] },
  bookstore: { name: '纸页书屋', owner: 'claude', area: 'square', door: [1035, 372] },
  observatory: { name: '星仪万事屋', owner: 'gpt', area: 'square', door: [322, 775] },
};

// 活动：给模型看的说明、默认图标
export const ACTIVITIES = {
  work: { desc: '在自己店里干活/看店（只能在自己的店里）', icon: null },
  eat: { desc: '吃饭、吃点心', icon: 'bowl' },
  read: { desc: '看书、看报', icon: 'book' },
  write: { desc: '写东西、记笔记、写告示', icon: 'scroll' },
  slack: { desc: '摸鱼、发呆', icon: 'fish' },
  rest: { desc: '休息、看风景、散步后歇脚', icon: 'sparkle' },
  chat: { desc: '和人聊天（要和对方在同一个地方）', icon: 'chat' },
  play: { desc: '玩耍、荡秋千、堆沙堡', icon: 'sparkle' },
  stargaze: { desc: '看星星、看天（晚上更合适）', icon: 'star' },
  shop: { desc: '逛摊、买东西', icon: 'gift' },
  errand: { desc: '跑腿、帮人做委托、搬东西', icon: 'pin' },
  pray: { desc: '许愿、祈福', icon: 'bell' },
  sleep: { desc: '回家睡觉（只能在自己的店里，晚上）', icon: 'zzz' },
};

// 地点。inside 表示进到店里；acts 是这里能做的事
export const PLACES = {
  diner: { area: 'square', inside: 'diner', name: '深海食堂（店里）', acts: ['work', 'eat', 'rest', 'chat', 'sleep'] },
  bookstore: { area: 'square', inside: 'bookstore', name: '纸页书屋（店里）', acts: ['work', 'read', 'write', 'rest', 'chat', 'sleep'] },
  observatory: { area: 'square', inside: 'observatory', name: '星仪万事屋（店里）', acts: ['work', 'stargaze', 'read', 'rest', 'chat', 'sleep'] },
  fountain: { area: 'square', at: [735, 545], name: '广场的许愿喷泉旁', acts: ['rest', 'chat', 'play', 'slack', 'pray'] },
  benchE: { area: 'square', at: [890, 470], name: '广场东边的长椅', acts: ['read', 'rest', 'write', 'chat', 'slack'] },
  benchW: { area: 'square', at: [590, 452], name: '广场西边的长椅', acts: ['slack', 'rest', 'eat', 'chat', 'read'] },
  blackboard: { area: 'square', at: [930, 362], name: '书屋门口的小黑板', acts: ['write', 'read', 'chat'] },
  pier: { area: 'square', at: [1345, 702], name: '广场旁的栈桥', acts: ['stargaze', 'rest', 'chat', 'slack'] },
  beach: { area: 'square', at: [640, 800], name: '广场下的小沙滩', acts: ['rest', 'play', 'slack', 'chat'] },
  fruit: { area: 'market', at: [335, 330], name: '集市的水果摊', acts: ['shop', 'eat', 'chat'] },
  fishstall: { area: 'market', at: [590, 330], name: '集市的鱼摊', acts: ['shop', 'chat'] },
  flower: { area: 'market', at: [835, 335], name: '集市的花摊', acts: ['shop', 'chat'] },
  snack: { area: 'market', at: [1040, 335], name: '集市的点心推车', acts: ['shop', 'eat', 'chat'] },
  post: { area: 'market', at: [1232, 302], name: '集市的驿站', acts: ['errand', 'chat', 'write'] },
  jetty: { area: 'market', at: [905, 522], name: '集市的小码头', acts: ['errand', 'rest', 'chat', 'stargaze'] },
  umbrella: { area: 'market', at: [370, 600], name: '沙滩遮阳伞下', acts: ['rest', 'slack', 'read', 'chat'] },
  sandcastle: { area: 'market', at: [440, 735], name: '沙滩上的沙堡', acts: ['play', 'rest'] },
  shrine: { area: 'park', at: [214, 200], name: '后山神社的许愿铃', acts: ['pray', 'rest'] },
  ema: { area: 'park', at: [410, 232], name: '神社旁的许愿牌', acts: ['write', 'pray', 'read'] },
  tree: { area: 'park', at: [852, 598], name: '后山的古树下', acts: ['read', 'rest', 'chat', 'write', 'slack'] },
  swing: { area: 'park', at: [930, 525], name: '古树上的秋千', acts: ['play', 'rest'] },
  bridge: { area: 'park', at: [1250, 480], name: '锦鲤池上的小木桥', acts: ['rest', 'chat', 'slack'] },
  picnic: { area: 'park', at: [300, 760], name: '草坪上的野餐垫', acts: ['eat', 'rest', 'chat', 'read', 'play'] },
  benchP: { area: 'park', at: [145, 670], name: '公园长椅', acts: ['read', 'rest', 'slack'] },
  board: { area: 'park', at: [718, 869], name: '公园公告栏', acts: ['read', 'write'] },
  pierEnd: { area: 'market', at: [1022, 598], name: '小码头尽头', acts: ['rest', 'slack', 'chat', 'stargaze'] },
  // 灯塔在海里的礁石上，走不过去：大家在海堤上看它；会飞的 GPT 能飞到灯上（fly）
  lighthouse: { area: 'market', at: [1364, 436], fly: [1446, 652], flyName: '灯塔', name: '看得见灯塔的海堤', acts: ['rest', 'stargaze', 'chat', 'errand'] },
};

// 地点的站位落到最近的可走格上
for (const p of Object.values(PLACES)) {
  const at = p.inside ? SHOPS[p.inside].door : p.at;
  const g = AREAS[p.area].grid, c = nearestWalkable(g, at[0], at[1]);
  p.stand = c ? center(g, c) : at;
}
for (const s of Object.values(SHOPS)) {
  const g = AREAS[s.area].grid, c = nearestWalkable(g, s.door[0], s.door[1]);
  s.stand = center(g, c);
}

// 每个角色的动作帧行（客户端 atlas 的行名），以及「工作」时的图标
export const ANIM = {
  ds: { work: 'happy', eat: 'eat', read: 'slack', write: 'idle', slack: 'slack', rest: 'idle', chat: 'happy', play: 'happy', stargaze: 'idle', shop: 'happy', errand: 'idle', pray: 'idle', sleep: 'sleepy', workIcon: 'bowl' },
  claude: { work: 'work', eat: 'idle', read: 'read', write: 'work', slack: 'idle', rest: 'idle', chat: 'idle', play: 'idle', stargaze: 'read', shop: 'idle', errand: 'idle', pray: 'idle', sleep: 'sleepy', workIcon: 'scroll' },
  gpt: { work: 'astro', eat: 'happy', read: 'astro', write: 'astro', slack: 'idle', rest: 'idle', chat: 'happy', play: 'happy', stargaze: 'astro', shop: 'happy', errand: 'happy', pray: 'idle', sleep: 'sleepy', workIcon: 'star' },
};

// 从 a 区域到 b 区域要经过的路口序列（区域图很小，直接广度优先）
export function route(a, b) {
  if (a === b) return [];
  const q = [[a, []]], seen = new Set([a]);
  while (q.length) {
    const [cur, path] = q.shift();
    for (const l of LINKS) {
      for (const [x, y, xt, yt] of [[l.a, l.b, l.at, l.bt], [l.b, l.a, l.bt, l.at]]) {
        if (x !== cur || seen.has(y)) continue;
        const step = { from: x, to: y, exit: xt, entry: yt };
        if (y === b) return [...path, step];
        seen.add(y); q.push([y, [...path, step]]);
      }
    }
  }
  return null;
}
