'use strict';
// 刷怪导演：按曲式和时间决定每小节刷多少、刷什么、什么阵型。刷怪落在拍点上。

const Director = (() => {
  const MAX_ALIVE = 620;

  // 每小节预算（按 128 BPM 设计，其它 BPM 按小节时长换算）
  function budget(sec, p) {
    const ot = Seq.S.flags.overtime || 0;
    switch (sec.id) {
      case 'intro': return 3 + 6 * p;
      case 'grooveA': return 9 + 9 * p;
      case 'build1': return 12 + 8 * p;
      case 'drop1': return 18 + 8 * p;
      case 'break1': return 6;
      case 'grooveB': return 18 + 12 * p;
      case 'build2': return 22 + 8 * p;
      case 'drop2': return 26 + 9 * p;
      case 'break2': return 10;
      case 'build3': return 26 + 8 * p;
      case 'final': return (38 + 16 * p) * (1 + 0.3 * ot);
      default: return 0;
    }
  }

  function pickType(m) {
    const w = [['noise', 1]];
    if (m >= 0.8) w.push(['glitch', 0.22 + 0.05 * m]);
    if (m >= 2) w.push(['sub', 0.07 + 0.02 * m]);
    if (m >= 3) w.push(['ticker', 0.05 + 0.012 * m]);
    if (m >= 4) w.push(['feedback', 0.05 + 0.012 * m]);
    let tot = 0;
    for (const [, v] of w) tot += v;
    let r = Math.random() * tot;
    for (const [k, v] of w) {
      r -= v;
      if (r <= 0) return k;
    }
    return 'noise';
  }

  // 屏幕外一圈的刷怪点，偏向玩家前进方向
  function spawnPoint(extra = 60) {
    const p = W.player;
    const v = R.view();
    const rad = Math.hypot(v.halfW, v.halfH) + extra;
    let a;
    if (p.moving && Math.random() < 0.55) a = p.face + (Math.random() - 0.5) * 2.0;
    else a = Math.random() * TAU;
    return { x: p.x + Math.cos(a) * rad, y: p.y + Math.sin(a) * rad };
  }

  function onStep(ev) {
    const I = ev.I;
    const sec = I.sec;
    if (sec.type === 'outro' || sec.type === 'menu') return;
    const m = W.minutes();
    // 拍点刷怪
    if (ev.pos % 4 === 0 && W.aliveCount() < MAX_ALIVE) {
      const bossOn = W.enemies.some((e) => e.boss && !e.dying);
      const perBar = budget(sec, I.p) * (128 / Seq.S.bpm) * W.diff * (bossOn ? 0.65 : 1);
      let n = perBar / 4;
      n = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0);
      for (let i = 0; i < n; i++) {
        const sp = spawnPoint(40 + Math.random() * 80);
        W.spawnEnemy(pickType(m), sp.x, sp.y);
      }
    }
    // 铺垫段：最后几小节合围
    if (sec.type === 'build' && ev.pos === 0) {
      const ringsFrom = sec.bars - 4;
      if (I.barIn >= ringsFrom) {
        const k = I.barIn - ringsFrom;
        const layers = sec.rings || 1;
        for (let L = 0; L < layers; L++) {
          const cnt = Math.round((14 + k * 5 + m * 2.5) * (128 / Seq.S.bpm + 1) / 2);
          const rad = Math.hypot(R.view().halfW, R.view().halfH) + 40 + L * 110;
          summonRing(W.player.x, W.player.y, cnt, L === 1 && m > 3 ? 'glitch' : 'noise', rad, true);
        }
      }
    }
    // 毛刺流：律动 B 之后每 4 小节
    if ((sec.id === 'grooveB' || sec.id === 'drop2' || sec.id === 'final') && I.barIn % 4 === 2 && ev.pos === 8) {
      stream('glitch', 8 + Math.floor(m));
    }
    // 低频方阵
    if ((sec.id === 'grooveB' || sec.id === 'final') && I.barIn % 8 === 5 && ev.pos === 0) {
      phalanx(Math.min(16, 6 + Math.floor(m)));
    }
    // 精英：回落段
    if (sec.type === 'brk' && ev.pos === 0) {
      const n = sec.elites || 1;
      if (I.barIn === 2 || (n >= 2 && I.barIn === Math.floor(sec.bars / 2) + 1)) {
        const sp = spawnPoint(30);
        W.spawnEnemy(m > 4 ? 'sub' : 'noise', sp.x, sp.y, { elite: true });
      }
    }
  }

  function summonRing(cx, cy, n, type, rad, inward) {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU;
      if (W.aliveCount() >= MAX_ALIVE + 120) return;
      W.spawnEnemy(type, cx + Math.cos(a) * rad, cy + Math.sin(a) * rad, { ring: inward });
    }
  }
  function stream(type, n) {
    const p = W.player;
    const v = R.view();
    const a = Math.random() * TAU;
    const rad = Math.hypot(v.halfW, v.halfH) + 80;
    const sx = p.x + Math.cos(a) * rad, sy = p.y + Math.sin(a) * rad;
    const dir = Math.atan2(p.y - sy, p.x - sx) + (Math.random() - 0.5) * 0.3;
    const nx = -Math.sin(dir), ny = Math.cos(dir);
    for (let i = 0; i < n; i++) {
      const back = i * 34;
      W.spawnEnemy(type, sx - Math.cos(dir) * back + nx * (i % 2 ? 18 : -18), sy - Math.sin(dir) * back + ny * (i % 2 ? 18 : -18), {
        straight: true, vx: Math.cos(dir) * 300, vy: Math.sin(dir) * 300,
      });
    }
  }
  function phalanx(n) {
    const sp = spawnPoint(60);
    const side = Math.ceil(Math.sqrt(n));
    for (let i = 0; i < n; i++) {
      W.spawnEnemy('sub', sp.x + (i % side) * 58 - side * 29, sp.y + Math.floor(i / side) * 58 - side * 29);
    }
  }

  return { onStep, summonRing, stream, spawnPoint, MAX_ALIVE };
})();
