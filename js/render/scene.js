'use strict';
// 把世界画进渲染批次：玩家、敌人、弹体、危险物、粒子，以及相机和后处理参数。

const Scene = (() => {
  const GEM_COL = [U.hex('#4ff0ff', 1.6), U.hex('#5cff9d', 1.8), U.hex('#ffd84a', 2.2), U.hex('#ff6ad5', 2.4)];
  const HEAL_COL = U.hex('#5cff9d', 2);
  const MAG_COL = U.hex('#4fa8ff', 2);
  const CHEST_COL = U.hex('#ffd56a', 2.2);
  const RED = U.hex('#ff3b5c', 2.5);
  const WHITE3 = [1.7, 1.7, 1.8];
  let specSmooth = new Float32Array(48);
  let autoDim = 1;
  let FX_BUDGET = 0.25; // 玩家特效叠加亮度预算（占视野面积的比例），实测标定
  let tintCur = null, tint2Cur = null;

  function mix(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  // 相机与后处理
  function camera(dt) {
    const p = W.player;
    const lead = p.moving ? 50 : 0;
    const tx = p.x + Math.cos(p.face) * lead;
    const ty = p.y + Math.sin(p.face) * lead;
    const c = R.cam;
    c.x = U.damp(c.x, tx, 7, dt);
    c.y = U.damp(c.y, ty, 7, dt);
    W.kick *= Math.exp(-7 * dt);
    W.punch *= Math.exp(-5 * dt);
    c.zoom = 1 + 0.016 * W.kick + W.punch;
    W.shakeAmt *= Math.exp(-9 * dt);
    c.sx = (Math.random() - 0.5) * W.shakeAmt * 2;
    c.sy = (Math.random() - 0.5) * W.shakeAmt * 2;
    const P = R.post;
    W.flashAmt *= Math.exp(-6 * dt);
    W.caAmt *= Math.exp(-4 * dt);
    P.flash = W.flashAmt;
    P.kick = W.kick;
    P.beat = U.clamp((W.heard - (W.lastKickT || -9)) / 0.75, 0, 1);
    P.ca = 0.0012 + W.caAmt + 0.0035 * W.kick * (W.reduceFlash ? 0.3 : 1);
    P.hurt *= Math.exp(-4 * dt);
    P.time += dt;
    // 段落色调
    const st = W.style;
    let t1 = U.hex(st.grid, 1), t2 = U.hex(st.tint2, 1);
    const I = W.curI;
    let glow = 1;
    if (I) {
      if (I.type === 'brk') { t1 = mix(t1, U.hex('#7a3cff', 1), 0.6); glow = 0.7; }
      else if (I.type === 'drop') { glow = 1.35; }
      else if (I.type === 'build') { glow = 0.9 + I.p * 0.6; t2 = mix(t2, [1, 1, 1], I.p * 0.3); }
      else if (I.type === 'intro') { glow = 0.6 + I.p * 0.4; }
      if (I.sec && I.sec.final) t1 = mix(t1, U.hex('#ff3c7a', 1), 0.35);
    }
    if (!tintCur) { tintCur = t1; tint2Cur = t2; }
    const k = 1 - Math.exp(-2 * dt);
    tintCur = mix(tintCur, t1, k);
    tint2Cur = mix(tint2Cur, t2, k);
    P.tint = tintCur;
    P.tint2 = tint2Cur;
    P.gridGlow = U.damp(P.gridGlow, glow, 2, dt);
    P.desat = U.damp(P.desat, W.frozen ? 0.35 : W.over ? 0.6 : 0, 6, dt);
    P.exposure = U.damp(P.exposure, W.frozen ? 0.75 : 1, 6, dt);
  }

  function draw() {
    const p = W.player;
    const v = R.view();
    const cx = R.cam.x, cy = R.cam.y;
    const mX = v.halfW + 80, mY = v.halfH + 80;
    const vis = (x, y, m = 0) => Math.abs(x - cx) < mX + m && Math.abs(y - cy) < mY + m;
    const kick = W.kick;

    // 经验宝石
    for (const g of W.gems) {
      if (!vis(g.x, g.y)) continue;
      const tier = g.v >= 50 ? 3 : g.v >= 20 ? 2 : g.v >= 5 ? 1 : 0;
      const s = 4.5 + tier * 1.8;
      R.sprite(g.x, g.y, s * 1.2, g.age * 2, SH.RHOMB, s, s * 0.62, GEM_COL[tier], 0.85, 0.45, 1.1, 2.5, 0.35);
    }
    // 拾取物
    for (const k of W.pickups) {
      const pulse = 1 + 0.15 * kick;
      if (k.kind === 'heal') R.sprite(k.x, k.y, 12, 0, SH.CROSS, 10 * pulse, 3.5, HEAL_COL, 1, 1, 0, 5, 0.6);
      else if (k.kind === 'magnet') R.ring(k.x, k.y, 9 * pulse, 3, MAG_COL, 1);
      else if (k.kind === 'chest') {
        R.sprite(k.x, k.y, 18, Math.sin(W.time * 2) * 0.15, SH.BOX, 14 * pulse, 11 * pulse, CHEST_COL, 1, 0.35, 2.5, 8, 0.8);
        R.ring(k.x, k.y, 26 + 10 * kick, 1.5, CHEST_COL, 0.6);
      }
    }
    // Pad 光环
    if (W.inst.pad) {
      const r = W.auraR || 100;
      const a = 0.35 + 0.65 * (W.auraPulse || 0);
      R.ring(p.x, p.y, r, 1.2 + 2.5 * (W.auraPulse || 0), INST.pad.rgb, a * 0.7, 0.6);
      R.sprite(p.x, p.y, r, 0, SH.CIRCLE, r, 0, INST.pad.rgb, 0.02 + 0.04 * (W.auraPulse || 0), 1, 0, 1, 0);
    }
    // 玩家特效强度 = 设置 × 自动曝光（上一帧的叠加亮度超出预算就压暗）
    const fa = (W.fxAlpha !== undefined ? W.fxAlpha : 0.85) * autoDim;
    let loadSum = 0;
    // 燃烧地面
    R.track(true);
    R.setAlpha(fa);
    for (const b of W.burns) {
      const a = (1 - b.t / b.life) * (0.7 + 0.3 * Math.random());
      if (b.disc) {
        R.sprite(b.x, b.y, b.r, 0, SH.CIRCLE, b.r, 0, b.color, a * (b.small ? 0.18 : 0.08), 1, 0, 2, 0);
        if (!b.small) R.ring(b.x, b.y, b.r, 1.2, b.color, a * 0.5, 0.4);
      } else R.ring(b.x, b.y, b.r, b.th * 0.35, b.color, a * 0.45, 0.5);
    }
    loadSum += R.load;
    R.track(false);
    R.setAlpha(1);
    // 敌人
    for (const e of W.enemies) {
      if (!vis(e.x, e.y, e.r * 2)) continue;
      if (e.boss) {
        let a = 1;
        if (e.entering > 0) a = 1 - e.entering / 1.2 * 0.7;
        e.def.draw(e, a);
        if (e.flash > 0) R.ring(e.x, e.y, e.r * 1.05, 1.5, WHITE3, e.flash * 0.18, 0.3);
        continue;
      }
      const d = e.def;
      const sp = e.spawnT > 0 ? 1 - (e.spawnT / 0.3) * 0.7 : 1;
      const s = e.r * sp * (1 + 0.1 * kick);
      let col = e.dying ? WHITE3 : e.flash > 0 ? mix(d.rgb, WHITE3, Math.min(1, e.flash)) : d.rgb;
      let rot = e.rot;
      if (e.type === 'noise') rot = Math.atan2(p.y - e.y, p.x - e.x);
      else if (e.type === 'glitch' && e.straight) rot = Math.atan2(e.vy, e.vx);
      const a = e.dying ? 0.9 : 1;
      if (e.type === 'glitch') R.sprite(e.x, e.y, s * 1.3, rot, SH.RHOMB, s * 1.3, s * 0.55, col, a, 0.25, 2, 4, 0.5);
      else if (e.type === 'feedback') {
        R.ring(e.x, e.y, s * 0.8, 2.5, col, a);
        R.dot(e.x, e.y, s * 0.35, e.fuseT && Math.sin(W.time * 40) > 0 ? WHITE3 : d.rgbHot, a);
      } else R.shape(e.x, e.y, s, rot, d.shape, col, a, 0.22, 2.2);
      if (e.elite) R.ring(e.x, e.y, s * 1.35 + 3 * kick, 2, ELITE_RGB, 0.8);
      if (e.tele > 0) R.shape(e.x, e.y, s * 1.4, rot, d.shape, U.hex('#ffd23c', 3), e.tele, 0, 2);
      if (e.spawnT > 0) R.ring(e.x, e.y, e.r * (2.5 - sp * 1.5), 1.5, d.rgbHot, e.spawnT / 0.3);
    }
    // 危险物
    for (const h of W.hazards) {
      if (h.kind === 'ring') {
        R.arc(h.x, h.y, h.r, h.thick * 0.6, h.gap, h.gapHalf, h.color, 0.9);
      } else if (h.kind === 'laser') {
        const L = 2600;
        const dx = Math.cos(h.ang) * L, dy = Math.sin(h.ang) * L;
        if (W.heard < h.warnUntil) {
          const left = (h.warnUntil - W.heard) / Seq.beatDur();
          const blink = 0.35 + 0.35 * Math.sin(W.time * 30);
          R.line(h.x - dx, h.y - dy, h.x + dx, h.y + dy, 1.5 + (1 - left) * 3, h.color, blink * 0.5);
        } else {
          const f = 1 - (h.fireUntil - W.heard) / 0.22;
          R.line(h.x - dx, h.y - dy, h.x + dx, h.y + dy, h.width * 0.5 * (1 - f * 0.5), h.color, 1 - f * 0.6);
          R.line(h.x - dx, h.y - dy, h.x + dx, h.y + dy, h.width * 0.15, WHITE3, 1 - f);
        }
      }
    }
    for (const b of W.ebullets) {
      if (!vis(b.x, b.y)) continue;
      R.dot(b.x, b.y, b.r, b.col, 1, 1.2);
      R.dot(b.x, b.y, b.r * 0.45, WHITE3, 0.8);
    }
    // 冲击波
    R.track(true);
    R.setAlpha(fa);
    for (const w of W.waves) {
      const f = U.clamp(w.age / w.dur, 0, 1);
      const small = w.maxR < 90 && w.inst !== 'dash';
      const th = Math.max(1, (w.inst === 'drop' ? 24 : small ? 2 : 5) * (1 - f));
      R.ring(w.x, w.y, Math.max(1, w.r), th, w.color, (1 - f) * (w.ghost ? 0.4 : small ? 0.45 : 0.85), small ? 0.3 : 0.6);
    }
    // 光束
    for (const b of W.beams) {
      const g = beamG(b);
      const fIn = U.clamp(b.age / 0.03, 0, 1);
      const fOut = b.age > b.dur ? Math.max(0, 1 - (b.age - b.dur) / 0.08) : 1;
      // 短激光：一闪就收窄；长激光保持
      const shrink = b.dur < 0.2 ? 1 - 0.5 * U.clamp(b.age / b.dur, 0, 1) : 1;
      const a = fIn * fOut * (b.ghost ? 0.45 : 1);
      R.line(g.x1, g.y1, g.x2, g.y2, b.width * 0.42 * shrink, b.color, a * 0.6, 0.55);
      R.line(g.x1, g.y1, g.x2, g.y2, b.width * 0.1 * shrink, WHITE3, a * 0.7, 0.35);
      R.dot(g.x2, g.y2, b.width * 0.35, b.color, a * 0.4);
    }
    // 光柱
    for (const pl of W.pillars) {
      const f = pl.age / 0.45;
      const w = Math.min(pl.r * 0.16, 12) * (1 - f);
      R.line(pl.x, pl.y - 520, pl.x, pl.y, Math.max(1, w), pl.color, (1 - f) * 0.8, 0.6);
      R.line(pl.x, pl.y - 520, pl.x, pl.y, Math.max(0.5, w * 0.25), WHITE3, (1 - f) * 0.8, 0.4);
      R.ring(pl.x, pl.y, pl.r * (0.6 + f * 0.6), 2.5 * (1 - f) + 1, pl.color, (1 - f) * 0.8, 0.5);
    }
    // 闪电
    for (const b of W.bolts) {
      const a = 1 - b.age / b.life;
      const n = 4;
      let px = b.x1, py = b.y1;
      for (let i = 1; i <= n; i++) {
        const t = i / n;
        const jx = i < n ? (Math.random() - 0.5) * 26 : 0, jy = i < n ? (Math.random() - 0.5) * 26 : 0;
        const nx = b.x1 + (b.x2 - b.x1) * t + jx, ny = b.y1 + (b.y2 - b.y1) * t + jy;
        R.line(px, py, nx, ny, 2.2, b.color, a);
        px = nx;
        py = ny;
      }
    }
    // 玩家弹体
    for (const s of W.shots) {
      if (!vis(s.x, s.y)) continue;
      const a = s.ghost ? 0.45 : 1;
      const ang = Math.atan2(s.vy, s.vx);
      if (s.shape === 7) {
        R.sprite(s.x, s.y, s.r * 1.3, s.age * (s.spin || 6), SH.STAR, s.r, 0, s.color, a, 0.5, 1.5, 5, 0.6);
      } else if (s.shape === 0) {
        // 主旋律音符：音符头（亮环）+ 小核心 + 短符干
        R.ring(s.x, s.y, s.r * 0.8, Math.max(1.2, s.r * 0.18), s.color, a * 0.9, 0.5);
        R.dot(s.x, s.y, s.r * 0.28, WHITE3, a * 0.8, 0.4);
        R.line(s.x + s.r * 0.75, s.y, s.x + s.r * 0.75, s.y - s.r * 2.2, 1, s.color, a * 0.7, 0.3);
      } else if (s.shape === 3) {
        R.sprite(s.x, s.y, s.r * 1.6, ang, SH.RHOMB, s.r * 1.6, s.r * 0.5, s.color, a, 0.8, 1, 4, 0.6);
      } else {
        const L = s.len;
        R.line(s.x - Math.cos(ang) * L, s.y - Math.sin(ang) * L, s.x, s.y, s.r * 0.55, s.color, a);
        R.dot(s.x, s.y, s.r * 0.5, WHITE3, a * 0.8);
      }
    }
    for (const h of W.homers) {
      if (!vis(h.x, h.y)) continue;
      const a = h.ghost ? 0.45 : 1;
      const sp = Math.hypot(h.vx, h.vy) || 1;
      R.line(h.x - (h.vx / sp) * 26, h.y - (h.vy / sp) * 26, h.x, h.y, h.r * 0.3, h.color, a * 0.55, 0.5);
      R.sprite(h.x, h.y, h.r * 1.2, Math.atan2(h.vy, h.vx), SH.RHOMB, h.r * 1.2, h.r * 0.7, h.color, a, 0.55, 1.4, 3, 0.5);
      R.dot(h.x, h.y, h.r * 0.3, WHITE3, a * 0.8, 0.4);
    }
    loadSum += R.load;
    R.track(false);
    R.setAlpha(1);
    // 叠加亮度预算：按视野面积归一化
    const budget = v.halfW * v.halfH * 4 * FX_BUDGET;
    const setA = W.fxAlpha !== undefined ? W.fxAlpha : 0.85;
    // loadSum 不含 alpha 乘子，实际亮度 = loadSum × 设置 × autoDim
    const want = U.clamp(budget / Math.max(1, loadSum * setA), 0.2, 1);
    autoDim += (want - autoDim) * (want < autoDim ? 0.25 : 0.04);
    W.fxLoad = (loadSum * setA) / budget;
    // 粒子
    for (const q of W.parts) {
      const a = q.life / q.max;
      if (q.shape === SH.SEG) {
        R.line(q.x - q.vx * 0.025, q.y - q.vy * 0.025, q.x, q.y, q.size * 0.5, q.col, a);
      } else if (q.shape === SH.RING) {
        R.ring(q.x, q.y, q.size, Math.max(1, 4 * a), q.col, a);
      } else {
        R.shape(q.x, q.y, q.size, q.rot, q.shape, q.col, a * 0.6, 0.3, 1.5);
      }
    }
    drawPlayer();
  }

  function beamG(b) {
    const p = W.player;
    const f = U.clamp(b.age / b.dur, 0, 1);
    let ang = b.ang + (b.sweep || 0) * f;
    if (b.wobble) ang += Math.sin(b.age * 14) * 0.35;
    return { x1: p.x, y1: p.y, x2: p.x + Math.cos(ang) * b.len, y2: p.y + Math.sin(ang) * b.len };
  }

  function drawPlayer() {
    const p = W.player;
    if (!p.alive) return;
    const st = W.style;
    const col = U.hex(st.color, 1.6 + 1.2 * W.kick);
    const blink = p.invuln > 0 && p.dashT <= 0 ? (Math.sin(W.time * 50) > 0 ? 0.35 : 1) : 1;
    const s = 15 * (1 + 0.12 * W.kick);
    // 频谱环
    const spec = AE.spectrum();
    const n = specSmooth.length;
    for (let i = 0; i < n; i++) {
      let v = 0;
      if (spec) {
        const bin = Math.floor(2 + Math.pow(i / n, 1.6) * 100);
        v = spec[bin] / 255;
      } else {
        v = 0.3 * W.kick * (1 - i / n);
      }
      specSmooth[i] = Math.max(v, specSmooth[i] * 0.85);
      const a = (i / n) * TAU + W.time * 0.2;
      const r0 = 38, r1 = 38 + specSmooth[i] * 30;
      if (r1 - r0 > 2 && i % 2 === 0) {
        const c = U.hsl((i / n) * 0.6 + 0.45 + W.time * 0.02, 0.9, 0.6, 0.9);
        R.line(p.x + Math.cos(a) * r0, p.y + Math.sin(a) * r0, p.x + Math.cos(a) * r1, p.y + Math.sin(a) * r1, 0.9, c, 0.4 * blink, 0.4);
      }
    }
    // 律动 III 彩虹尾迹
    if (W.grooveTier >= 3 && Math.random() < 0.8) {
      W.parts.push({ x: p.x, y: p.y, vx: -p.vx * 0.1, vy: -p.vy * 0.1, size: 7, life: 0.5, max: 0.5, col: U.hsl(W.time * 0.8, 1, 0.6, 2), shape: SH.CIRCLE, rot: 0, grow: -10, drag: 2 });
    }
    // 飞船
    R.sprite(p.x, p.y, s * 1.4, p.face, SH.RHOMB, s * 1.35, s * 0.72, col, blink, 0.28, 2.4, 6, 0.8);
    R.sprite(p.x, p.y, s * 0.6, p.face, SH.RHOMB, s * 0.55, s * 0.3, WHITE3, blink, 1, 0, 4, 0.6);
    if (p.hitFlash > 0) R.dot(p.x, p.y, 26, RED, p.hitFlash * 0.5);
    // 护盾
    if (p.shield > 0) {
      for (let i = 0; i < p.shield; i++) R.ring(p.x, p.y, 24 + i * 6, 1.4, INST.pad.rgb, 0.7 + 0.3 * W.kick);
    }
    // 冲刺充能点
    const max = W.stats.dashMax;
    for (let i = 0; i < max; i++) {
      const a = p.face + Math.PI + (i - (max - 1) / 2) * 0.45;
      const on = i < p.charges;
      R.dot(p.x + Math.cos(a) * 24, p.y + Math.sin(a) * 24, on ? 2.6 : 1.6, on ? col : [0.15, 0.15, 0.2], on ? 1 : 0.6, 0.6);
    }
  }

  return { camera, draw, setBudget: (b) => { FX_BUDGET = b; }, get autoDim() { return autoDim; } };
})();
