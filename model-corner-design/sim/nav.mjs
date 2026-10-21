// 寻路：每个区域一张可走网格（tools/walkmask.py 从地图图片生成，8 px 一格），A* 找路，再把锯齿拉直
import { readFileSync } from 'node:fs';

export function loadGrid(file) {
  const g = JSON.parse(readFileSync(file, 'utf8'));
  const cells = new Uint8Array(g.w * g.h);
  g.rows.forEach((row, y) => { for (let x = 0; x < g.w; x++) cells[y * g.w + x] = row.charCodeAt(x) === 49 ? 1 : 0; });
  return { cell: g.cell, w: g.w, h: g.h, cells };
}

const walkable = (g, cx, cy) => cx >= 0 && cy >= 0 && cx < g.w && cy < g.h && g.cells[cy * g.w + cx] === 1;

// 离 (x, y) 最近的可走格（按格子做广度优先）
export function nearestWalkable(g, x, y) {
  const sx = Math.min(g.w - 1, Math.max(0, Math.floor(x / g.cell))), sy = Math.min(g.h - 1, Math.max(0, Math.floor(y / g.cell)));
  if (walkable(g, sx, sy)) return [sx, sy];
  const seen = new Uint8Array(g.w * g.h), q = [[sx, sy]];
  seen[sy * g.w + sx] = 1;
  for (let i = 0; i < q.length; i++) {
    const [cx, cy] = q[i];
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= g.w || ny >= g.h || seen[ny * g.w + nx]) continue;
      if (walkable(g, nx, ny)) return [nx, ny];
      seen[ny * g.w + nx] = 1; q.push([nx, ny]);
    }
  }
  return null;
}

export const center = (g, [cx, cy]) => [cx * g.cell + g.cell / 2, cy * g.cell + g.cell / 2];

// 线段经过的格子是否都可走（带一点宽度，避免贴着墙角擦过去）
function clear(g, [x0, y0], [x1, y1]) {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / (g.cell / 3));
  for (let i = 0; i <= n; i++) {
    const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
    for (const [ox, oy] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) {
      if (!walkable(g, Math.floor((x + ox) / g.cell), Math.floor((y + oy) / g.cell))) return false;
    }
  }
  return true;
}

// 最小堆
class Heap {
  constructor() { this.a = []; }
  push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) { a[0] = last; let i = 0; for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } }
    return top;
  }
  get size() { return this.a.length; }
}

// 从 from 走到 to（地图坐标），返回折线点；走不到返回 null
export function findPath(g, from, to) {
  const s = nearestWalkable(g, from[0], from[1]), t = nearestWalkable(g, to[0], to[1]);
  if (!s || !t) return null;
  const W = g.w, N = W * g.h, start = s[1] * W + s[0], goal = t[1] * W + t[0];
  const cost = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
  const hx = (i) => { const dx = Math.abs(i % W - t[0]), dy = Math.abs(Math.floor(i / W) - t[1]); return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy); };
  const heap = new Heap();
  cost[start] = 0; heap.push(hx(start), start);
  while (heap.size) {
    const [, i] = heap.pop();
    if (done[i]) continue;
    if (i === goal) break;
    done[i] = 1;
    const cx = i % W, cy = Math.floor(i / W);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (!walkable(g, nx, ny)) continue;
        if (dx && dy && (!walkable(g, cx + dx, cy) || !walkable(g, cx, cy + dy))) continue; // 不切墙角
        const j = ny * W + nx, c = cost[i] + (dx && dy ? Math.SQRT2 : 1);
        if (c < cost[j]) { cost[j] = c; prev[j] = i; heap.push(c + hx(j), j); }
      }
    }
  }
  if (prev[goal] === -1 && goal !== start) return null;
  const cells = [];
  for (let i = goal; i !== -1; i = prev[i]) cells.push([i % W, Math.floor(i / W)]);
  cells.reverse();
  // 拉直：从当前点出发，能直线看到的最远点就直接连过去
  const pts = [[...from], ...cells.map((c) => center(g, c)), [...to]];
  if (!walkable(g, Math.floor(from[0] / g.cell), Math.floor(from[1] / g.cell))) pts[0] = center(g, s);
  if (!walkable(g, Math.floor(to[0] / g.cell), Math.floor(to[1] / g.cell))) pts[pts.length - 1] = center(g, t);
  const out = [pts[0]];
  let i = 0;
  while (i < pts.length - 1) {
    let j = pts.length - 1;
    while (j > i + 1 && !clear(g, pts[i], pts[j])) j--;
    out.push(pts[j]); i = j;
  }
  return out.map(([x, y]) => [Math.round(x), Math.round(y)]);
}

export const pathLength = (pts) => pts.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
