'use strict';
// 通用工具：数学、随机数、颜色、空间网格

const TAU = Math.PI * 2;

const U = {
  clamp: (v, a, b) => (v < a ? a : v > b ? b : v),
  lerp: (a, b, t) => a + (b - a) * t,
  // 帧率无关的指数趋近
  damp: (a, b, rate, dt) => b + (a - b) * Math.exp(-rate * dt),
  smoothstep: (a, b, x) => {
    const t = U.clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  },
  dist2: (ax, ay, bx, by) => {
    const dx = ax - bx, dy = ay - by;
    return dx * dx + dy * dy;
  },
  angleDiff: (a, b) => {
    let d = (a - b) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  },

  // mulberry32 种子随机数
  rng(seed) {
    let s = seed >>> 0;
    const f = () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    f.range = (a, b) => a + (b - a) * f();
    f.int = (a, b) => a + Math.floor(f() * (b - a + 1));
    f.pick = (arr) => arr[Math.floor(f() * arr.length)];
    f.chance = (p) => f() < p;
    return f;
  },

  // 颜色：输入 sRGB，输出线性空间（渲染管线是线性的，最后再 gamma）
  toLin: (c) => Math.pow(c, 2.2),
  hex(h, mul = 1) {
    const n = parseInt(h.replace('#', ''), 16);
    return [
      U.toLin(((n >> 16) & 255) / 255) * mul,
      U.toLin(((n >> 8) & 255) / 255) * mul,
      U.toLin((n & 255) / 255) * mul,
    ];
  },
  hsl(h, s, l, mul = 1) {
    h = ((h % 1) + 1) % 1;
    const k = (n) => (n + h * 12) % 12;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return [U.toLin(f(0)) * mul, U.toLin(f(8)) * mul, U.toLin(f(4)) * mul];
  },
  // 音高 → 色相：按五度圈排布，同一和弦里的颜色彼此协调
  pitchHue(midi) {
    const pc = ((midi % 12) + 12) % 12;
    return ((pc * 7) % 12) / 12;
  },
  pitchColor(midi, mul = 1) {
    return U.hsl(U.pitchHue(midi) + 0.55, 0.85, 0.6, mul);
  },
  cssColor(rgbLin) {
    const g = (c) => Math.round(255 * Math.pow(U.clamp(c, 0, 1), 1 / 2.2));
    return `rgb(${g(rgbLin[0])},${g(rgbLin[1])},${g(rgbLin[2])})`;
  },

  fmtTime(sec) {
    sec = Math.max(0, Math.floor(sec));
    const m = Math.floor(sec / 60), s = sec % 60;
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  },

  shuffle(arr, rnd = Math.random) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  },
};

// 以玩家为中心的稠密空间网格（计数排序），每帧重建，查询很快
class SpatialGrid {
  constructor(cell, cols, rows) {
    this.cell = cell;
    this.cols = cols;
    this.rows = rows;
    this.counts = new Int32Array(cols * rows);
    this.starts = new Int32Array(cols * rows + 1);
    this.items = [];
    this.cellOf = new Int32Array(4096);
    this.ox = 0;
    this.oy = 0;
  }
  cellIndex(x, y) {
    let cx = Math.floor((x - this.ox) / this.cell);
    let cy = Math.floor((y - this.oy) / this.cell);
    if (cx < 0) cx = 0; else if (cx >= this.cols) cx = this.cols - 1;
    if (cy < 0) cy = 0; else if (cy >= this.rows) cy = this.rows - 1;
    return cy * this.cols + cx;
  }
  build(list, n, centerX, centerY) {
    this.ox = centerX - (this.cols * this.cell) / 2;
    this.oy = centerY - (this.rows * this.cell) / 2;
    if (this.cellOf.length < n) this.cellOf = new Int32Array(n * 2);
    const counts = this.counts, starts = this.starts;
    counts.fill(0);
    for (let i = 0; i < n; i++) {
      const e = list[i];
      const c = this.cellIndex(e.x, e.y);
      this.cellOf[i] = c;
      counts[c]++;
    }
    let acc = 0;
    for (let c = 0; c < counts.length; c++) {
      starts[c] = acc;
      acc += counts[c];
    }
    starts[counts.length] = acc;
    this.items.length = n;
    const write = counts; // 复用为写指针
    for (let c = 0; c < write.length; c++) write[c] = starts[c];
    for (let i = 0; i < n; i++) this.items[write[this.cellOf[i]]++] = list[i];
  }
  // 遍历 (x,y) 半径 r 范围内格子里的对象（未做精确距离过滤）
  query(x, y, r, fn) {
    const cell = this.cell;
    let x0 = Math.floor((x - r - this.ox) / cell), x1 = Math.floor((x + r - this.ox) / cell);
    let y0 = Math.floor((y - r - this.oy) / cell), y1 = Math.floor((y + r - this.oy) / cell);
    if (x1 < 0 || y1 < 0 || x0 >= this.cols || y0 >= this.rows) return;
    if (x0 < 0) x0 = 0;
    if (y0 < 0) y0 = 0;
    if (x1 >= this.cols) x1 = this.cols - 1;
    if (y1 >= this.rows) y1 = this.rows - 1;
    const items = this.items, starts = this.starts;
    for (let cy = y0; cy <= y1; cy++) {
      const row = cy * this.cols;
      for (let cx = x0; cx <= x1; cx++) {
        const c = row + cx;
        for (let k = starts[c], end = starts[c + 1]; k < end; k++) {
          if (fn(items[k]) === true) return;
        }
      }
    }
  }
}
