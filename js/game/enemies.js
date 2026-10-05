'use strict';
// 敌人与 Boss。敌人是“噪音”：暖色几何体，随拍子涌动。
// Boss 招式都提前一拍预警，在拍点上生效（声音同时在那个拍点上响）。

const ENEMY = {
  noise: { name: '杂音', shape: SH.TRI, r: 13, hp: 10, speed: 88, dmg: 8, xp: 1, color: '#ff3b5c', mass: 1 },
  glitch: { name: '毛刺', shape: SH.RHOMB, r: 12, hp: 6, speed: 168, dmg: 6, xp: 1, color: '#ff3cf0', mass: 0.6 },
  sub: { name: '低频块', shape: SH.HEX, r: 26, hp: 70, speed: 56, dmg: 12, xp: 5, color: '#ff8a2a', mass: 5 },
  ticker: { name: '节拍器', shape: SH.BOX, r: 15, hp: 28, speed: 80, dmg: 6, xp: 3, color: '#ffd23c', mass: 1.5, ranged: true },
  feedback: { name: '回授', shape: SH.CIRCLE, r: 14, hp: 20, speed: 120, dmg: 6, xp: 3, color: '#ff6a3c', mass: 1, fuse: true },
};
Object.values(ENEMY).forEach((d) => {
  d.rgb = U.hex(d.color, 1);
  d.rgbHot = U.hex(d.color, 2.2);
});
const ELITE_RGB = U.hex('#ffd56a', 2.4);
const WHITE = [1, 1, 1];
const HOT_WHITE = [1.8, 1.8, 1.9];

const BOSS = {
  // ---------------------------------------------------------------- 低音炮
  subwoofer: {
    name: '低音炮', en: 'SUBWOOFER', hp: 2500, r: 64, color: '#ff4a6a', speed: 75,
    init(b) {
      b.cone = 0;
    },
    update(b, dt) {
      const p = W.player;
      const dx = p.x - b.x, dy = p.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      const want = d > 170 ? b.speed : 0;
      b.x += (dx / d) * want * dt * W.beatMove;
      b.y += (dy / d) * want * dt * W.beatMove;
      b.cone = Math.max(0, b.cone - dt * 3);
    },
    onStep(b, ev) {
      const pos = ev.pos, bd = Seq.beatDur();
      const enraged = b.hp < b.maxHp * 0.5;
      // 冲击环：第 4 拍预警，下一小节第 1 拍发出（愤怒后每 2 拍）
      if (pos === 12 || (enraged && pos === 4)) {
        b.tele = 1;
        Synth.warn(Seq.gridSound(), 81);
        W.at(ev.t + bd, () => {
          b.cone = 1;
          const gap = Math.atan2(W.player.y - b.y, W.player.x - b.x) + (Math.random() - 0.5) * 2.4;
          W.hazards.push({ kind: 'ring', x: b.x, y: b.y, r: b.r, speed: 380, thick: 14, gap, gapHalf: enraged ? 0.38 : 0.5, maxR: 1500, dmg: 18, hit: false, color: U.hex('#ff3b6a', 2.5) });
          W.kickPulse(0.8);
          R.addRipple(b.x, b.y, 1.2, 1.4);
        }, () => Synth.wub(ev.t + bd, 33, 0.5, 1.1));
      }
      // 第 2 拍预警，第 3 拍召唤
      if (pos === 4 && !enraged) {
        W.at(ev.t + bd, () => Director.summonRing(b.x, b.y, 7, 'noise', 120));
      }
    },
    draw(b, a) {
      const col = U.hex(this.color, 1.6);
      const t = W.time;
      R.sprite(b.x, b.y, b.r * 1.1, t * 0.3, SH.HEX, b.r, 0, col, a, 0.08, 3, 5, 0.45);
      for (let i = 1; i <= 3; i++) {
        const rr = b.r * (0.25 * i) * (1 + b.cone * 0.25 * (4 - i) / 3);
        R.ring(b.x, b.y, rr, 1.2 + i * 0.6, U.hex('#ff9ab0', 0.7 + b.cone * 1.3), a, 0.5);
      }
      R.dot(b.x, b.y, b.r * 0.12 * (1 + b.cone), HOT_WHITE, a, 0.6);
      if (b.tele > 0) R.ring(b.x, b.y, b.r * 1.3, 3, U.hex('#ff3b6a', 3 * b.tele), a);
    },
  },

  // ---------------------------------------------------------------- 频谱
  spectrum: {
    name: '频谱', en: 'SPECTRUM', hp: 8000, r: 72, color: '#3cffd0', speed: 110,
    init(b) {
      b.bars = new Float32Array(9);
      b.orbit = Math.random() * TAU;
    },
    update(b, dt) {
      const p = W.player;
      b.orbit += dt * 0.35;
      const tx = p.x + Math.cos(b.orbit) * 340, ty = p.y + Math.sin(b.orbit) * 250;
      b.x = U.damp(b.x, tx, 1.2, dt);
      b.y = U.damp(b.y, ty, 1.2, dt);
      for (let i = 0; i < b.bars.length; i++) b.bars[i] = Math.max(0, b.bars[i] - dt * 2.5);
    },
    onStep(b, ev) {
      const pos = ev.pos, bd = Seq.beatDur();
      const I = ev.I;
      b.bars[(pos * 5) % b.bars.length] = 1;
      const enraged = b.hp < b.maxHp * 0.5;
      // 激光：第 1、3 拍预警，下一拍落下
      if (pos === 0 || pos === 8) {
        const n = enraged ? 3 : 2;
        const p = W.player;
        const base = Math.random() * Math.PI;
        for (let i = 0; i < n; i++) {
          const ang = base + (i * Math.PI) / n;
          const off = (i - (n - 1) / 2) * 150;
          const nx = -Math.sin(ang), ny = Math.cos(ang);
          W.hazards.push({ kind: 'laser', x: p.x + nx * off, y: p.y + ny * off, ang, width: 30, dmg: 16, warnUntil: ev.t + bd, fireUntil: ev.t + bd + 0.22, hit: false, color: U.hex('#3cffd0', 3) });
        }
        Synth.warn(Seq.gridSound(), 88);
        W.at(ev.t + bd, () => { R.addRipple(W.player.x, W.player.y, 0.5, 2); W.shake(5); }, () => Synth.zap(ev.t + bd, 1));
      }
      // 每个 4 小节乐句的最后一小节：16 分音符螺旋弹
      if (I.barIn % 4 === 3) {
        const k = I.pos;
        const arms = enraged ? 3 : 2;
        for (let a = 0; a < arms; a++) {
          const ang = k * 0.42 + (a * TAU) / arms;
          W.enemyShot(b.x, b.y, ang, 210, 8, 8, U.hex('#3cffd0', 2.4));
        }
        if (k % 2 === 0) Synth.woodblock(Seq.gridSound(), 0.5, true);
      }
    },
    draw(b, a) {
      const col = U.hex(this.color, 1.5);
      const n = b.bars.length;
      for (let i = 0; i < n; i++) {
        const x = b.x + (i - (n - 1) / 2) * 15;
        const h = 18 + b.bars[i] * 55 + 10 * Math.sin(W.time * 3 + i);
        R.sprite(x, b.y, h, 0, SH.BOX, 5, h, U.hex(i % 2 ? '#3cffd0' : '#7affe8', 1.4 + b.bars[i] * 2), a, 0.6, 1.5, 4, 0.5, h);
      }
      R.ring(b.x, b.y, b.r, 3, col, a * 0.8);
    },
  },

  // ---------------------------------------------------------------- 指挥家
  conductor: {
    name: '指挥家', en: 'CONDUCTOR', hp: 27000, r: 82, color: '#ffffff', speed: 90,
    init(b) {
      b.phase = 1;
      b.spin = 0;
    },
    update(b, dt) {
      const p = W.player;
      b.spin += dt * (0.6 + b.phase * 0.4);
      const dx = p.x - b.x, dy = p.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      const want = d > 300 ? b.speed : d < 220 ? -b.speed * 0.5 : 0;
      b.x += (dx / d) * want * dt;
      b.y += (dy / d) * want * dt;
      const ph = b.hp > b.maxHp * 0.66 ? 1 : b.hp > b.maxHp * 0.33 ? 2 : 3;
      if (ph !== b.phase) {
        b.phase = ph;
        W.bossPhase(b, ph);
      }
    },
    onStep(b, ev) {
      const pos = ev.pos, bd = Seq.beatDur();
      const I = ev.I;
      const ph = b.phase;
      // 冲击环
      const ringNow = ph === 1 ? pos === 12 : ph === 2 ? pos === 12 && I.barIn % 2 === 1 : pos === 12;
      if (ringNow) {
        Synth.warn(Seq.gridSound(), 76);
        W.at(ev.t + bd, () => {
          const gap = Math.atan2(W.player.y - b.y, W.player.x - b.x) + (Math.random() - 0.5) * 2.6;
          W.hazards.push({ kind: 'ring', x: b.x, y: b.y, r: b.r, speed: 400, thick: 15, gap, gapHalf: 0.42, maxR: 1600, dmg: 20, hit: false, color: U.hex('#ffffff', 2.5) });
          R.addRipple(b.x, b.y, 1.2, 1.4);
        }, () => Synth.wub(ev.t + bd, 31, 0.5, 1.1));
      }
      // 激光
      const laserNow = ph === 1 ? pos === 4 && I.barIn % 2 === 0 : ph === 3 ? pos === 4 || pos === 8 : false;
      if (laserNow) {
        const p = W.player;
        const n = ph === 3 ? 2 : 3;
        const base = Math.random() * Math.PI;
        for (let i = 0; i < n; i++) {
          const ang = base + (i * Math.PI) / n;
          W.hazards.push({ kind: 'laser', x: p.x, y: p.y, ang, width: 28, dmg: 20, warnUntil: ev.t + bd, fireUntil: ev.t + bd + 0.22, hit: false, color: U.hex('#ffe6a0', 3) });
        }
        Synth.warn(Seq.gridSound(), 93);
        W.at(ev.t + bd, () => W.shake(5), () => Synth.zap(ev.t + bd, 1));
      }
      // 螺旋弹幕
      if ((ph === 2 && pos % 2 === 0) || (ph === 3 && pos % 4 === 2)) {
        for (let a = 0; a < 2; a++) {
          const ang = b.spin * 2 + (a * Math.PI) + (I.step * 0.3);
          W.enemyShot(b.x, b.y, ang, 200, 8, 10, U.hsl((I.step * 0.03) % 1, 0.9, 0.6, 2.2));
          W.enemyShot(b.x, b.y, -ang, 200, 8, 10, U.hsl((I.step * 0.03 + 0.5) % 1, 0.9, 0.6, 2.2));
        }
      }
      // 三阶段：每 2 小节召唤毛刺流
      if (ph === 3 && pos === 0 && I.barIn % 2 === 0) Director.stream('glitch', 10);
    },
    draw(b, a) {
      const t = W.time;
      const col = U.hsl((t * 0.1) % 1, 0.8, 0.65, 1.8);
      R.sprite(b.x, b.y, b.r * 1.2, b.spin, SH.STAR, b.r, 0, col, a, 0.15, 3, 8, 0.6);
      R.ring(b.x, b.y, b.r * 0.45, 3, HOT_WHITE, a);
      for (let i = 0; i < 3 + b.phase; i++) {
        const ang = b.spin * 1.5 + (i * TAU) / (3 + b.phase);
        const r0 = b.r * 1.25, r1 = b.r * 1.9;
        R.line(b.x + Math.cos(ang) * r0, b.y + Math.sin(ang) * r0, b.x + Math.cos(ang) * r1, b.y + Math.sin(ang) * r1, 2.5, U.hsl((i / 6 + t * 0.1) % 1, 0.9, 0.6, 2), a);
      }
    },
  },
};
Object.values(BOSS).forEach((d) => { d.rgb = U.hex(d.color, 1.6); });
