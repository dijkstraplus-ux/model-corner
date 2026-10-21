// 条件和效果的小解释器：content/*.json 里写的 need / when / start / end / timers / daily 都由这里执行（不用 eval）

// 条件：用 && 和 || 连接的比较式，比如 "rice == empty || rice == cold"、"stock > 0 && hour >= 7"
export function cond(expr, get) {
  if (!expr) return true;
  return String(expr).split('||').some((or) => or.split('&&').every((term) => {
    const m = term.trim().match(/^(\S+)\s*(==|!=|>=|<=|>|<)\s*(.*)$/);
    if (!m) return false;
    const l = get(m[1]), raw = m[3].trim(), r = raw !== '' && !isNaN(+raw) ? +raw : raw;
    switch (m[2]) {
      case '==': return String(l) === String(r);
      case '!=': return String(l) !== String(r);
      case '>': return +l > +r;
      case '>=': return +l >= +r;
      case '<': return +l < +r;
      default: return +l <= +r;
    }
  }));
}

// 小而确定的随机数：同一个种子永远得到同一个结果，所有人看到的世界一样
export function seeded(seed) {
  let h = 2166136261;
  for (const ch of String(seed)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h += 0x6d2b79f5; let t = h; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

// 效果。ctx: { W, thing（当前物件 id）, who, text, gm, hours, vars（$tomorrow 等）, log(text, star), episode(e), rand() }
// pick：从列表里随机挑一个（种子随机），比如猫今天去哪儿
export function apply(eff, ctx) {
  if (!eff) return;
  const own = ctx.W.things[ctx.thing];
  const ref = (k) => (k.includes('.') ? [ctx.W.things[k.split('.')[0]], k.split('.')[1]] : [own, k]);
  const val = (x) => {
    if (typeof x === 'string') {
      if (/^\+\d+m$/.test(x)) return ctx.gm + parseInt(x.slice(1), 10);
      if (x === '$who') return ctx.who;
      if (x === '$text') return ctx.text || '';
      return x.replace(/\$(\w+)/g, (_, k) => (k === 'who' ? ctx.who : k === 'text' ? ctx.text || '' : ctx.vars?.[k] ?? `$${k}`));
    }
    if (Array.isArray(x)) return x.map(val);
    if (x && typeof x === 'object') return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, val(v)]));
    return x;
  };
  const amount = (x) => (typeof x === 'string' && x.endsWith('/h') ? parseFloat(x) * (ctx.hours || 0) : +x);
  for (const [op, v] of Object.entries(eff)) {
    if (op === 'set') for (const [k, x] of Object.entries(v)) { const [o, f] = ref(k); if (o) o[f] = val(x); }
    else if (op === 'add') for (const [k, x] of Object.entries(v)) { const [o, f] = ref(k); if (o) o[f] = Math.max(0, Math.round((+o[f] || 0) + amount(x))); }
    else if (op === 'mul') for (const [k, x] of Object.entries(v)) { const [o, f] = ref(k); if (o) o[f] = Math.round((+o[f] || 0) * x); }
    else if (op === 'push') for (const [k, x] of Object.entries(v)) {
      const [o, f] = ref(k); if (!o) continue;
      const item = val(x), list = Array.isArray(o[f]) ? o[f] : [];
      if (typeof item === 'string' ? item && !list.includes(item) : item && (item.text ?? true)) list.push(item);
      const cap = ctx.caps?.(k) ?? 6;
      o[f] = list.slice(-cap);
    }
    else if (op === 'sell') { const n = Math.min(+own.stock || 0, Math.max(0, Math.round(v * (ctx.hours || 0) * (0.6 + ctx.rand() * 0.8)))); own.stock -= n; own.sold = (+own.sold || 0) + n; }
    else if (op === 'bump') { const id = v === true ? ctx.thing : v; const o = ctx.W.things[id]; if (o) { o.ver = (o.ver || 0) + 1; o.seen = { [ctx.who]: o.ver }; } }
    else if (op === 'see') { if (own) own.seen = { ...(own.seen || {}), [ctx.who]: own.ver || 0 }; }
    else if (op === 'maybe') { if (ctx.rand() < v.p) apply(v.then, ctx); }
    else if (op === 'log') ctx.log?.(v, !!eff.star);
    else if (op === 'episode') ctx.episode?.(v, eff.log);
    else if (op === 'refresh') ctx.refresh?.(v);
    else if (op === 'give') ctx.give?.(v.k, v.n || 1);
    else if (op === 'eatbag') ctx.eatbag?.();
    else if (op === 'parcel') ctx.parcel?.(own?.[v]);
    else if (op === 'book') ctx.book?.();
    else if (op === 'pick') for (const [k, list] of Object.entries(v)) { const [o, f] = ref(k); if (o && list.length) o[f] = val(list[Math.floor(ctx.rand() * list.length)]); }
  }
}

// 模板：{who}、{text}、{字段}；列表字段按人名拼起来
export function fill(tpl, state, names, extra = {}) {
  return String(tpl).replace(/\{(\w+)\}/g, (_, k) => {
    if (k in extra) return extra[k];
    const v = state?.[k];
    if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? names[x] || x : x.text ? `「${x.text}」${names[x.by] ? `（${names[x.by]}）` : ''}` : '')).join('、') || '（空）';
    if (typeof v === 'string' && names[v]) return names[v];
    return v ?? '';
  });
}
