'use strict';
// 世界：玩家、敌人、弹体、拾取物、粒子、Boss 危险物。
// 时间域：
//   heard —— 扬声器正在发出的音频时间（事件、预警、量化爆炸都用它）
//   dt    —— 模拟步长（hold / 暂停时为 0）

const W = (() => {
  const W = {
    style: STYLES.house,
    meta: {},
    time: 0,
    heard: 0,
    frozen: false,
    resumeT: 0,
    player: null,
    enemies: [],
    dying: [],
    shots: [],
    homers: [],
    beams: [],
    waves: [],
    burns: [],
    pillars: [],
    bolts: [],
    ebullets: [],
    hazards: [],
    gems: [],
    pickups: [],
    parts: [],
    atQ: [],
    inst: {},
    fx: {},
    remix: {},
    stats: Effects.compute({}, null, {}),
    level: 1,
    xp: 0,
    xpNext: 10,
    pendingLevels: 0,
    pendingChests: 0,
    kills: 0,
    groove: 0,
    grooveTier: 0,
    perfects: 0,
    goods: 0,
    dashes: 0,
    maxCombo: 0,
    combo: 0,
    dmgTaken: 0,
    bossKills: [],
    instFlash: {},
    beatMove: 1,
    kick: 0,
    lastBeatT: 0,
    secIdx: -1,
    bar: -1,
    diff: 1,
    log: [],
    input: { x: 0, y: 0 },
    over: false,
    victory: false,
    camZoom: 1,
    punch: 0,
    shakeAmt: 0,
    flashAmt: 0,
    caAmt: 0,
    outro: false,
    reduceFlash: false,
    peakEnemies: 0,
  };

  let uid = 0;
  const grid = new SpatialGrid(64, 72, 72);
  const enemyPool = [];
  const tmp = [];
  const hitSlots = new Map();
  let pickupIdx = 0, pickupLastT = -10;

  // ---------------------------------------------------------------- 初始化
  W.reset = function (style, meta, opts = {}) {
    W.style = style;
    W.meta = meta || {};
    W.time = 0;
    W.heard = AE.Clock.now();
    W.frozen = false;
    W.resumeT = 0;
    W.player = {
      x: 0, y: 0, vx: 0, vy: 0, face: -Math.PI / 2, moving: false,
      hp: 100, maxHp: 100, invuln: 0, shield: 0,
      dashT: 0, dashVX: 0, dashVY: 0, dashPerfect: false, charges: 2, rech: 0,
      trailT: 0, alive: true, hitFlash: 0, judge: null,
    };
    for (const k of ['enemies', 'dying', 'shots', 'homers', 'beams', 'waves', 'burns', 'pillars', 'bolts', 'ebullets', 'hazards', 'gems', 'pickups', 'parts', 'atQ', 'log', 'bossKills']) W[k].length = 0;
    W.inst = {};
    W.fx = {};
    W.remix = {};
    W.level = 1;
    W.xp = 0;
    W.xpNext = xpFor(1);
    W.pendingLevels = 0;
    W.pendingChests = 0;
    W.kills = 0;
    W.groove = 0;
    W.grooveTier = 0;
    W.perfects = 0;
    W.goods = 0;
    W.dashes = 0;
    W.combo = 0;
    W.maxCombo = 0;
    W.dmgTaken = 0;
    W.instFlash = {};
    W.secIdx = -1;
    W.bar = -1;
    W.diff = opts.diff || 1;
    W.over = false;
    W.victory = false;
    W.outro = false;
    W.punch = 0;
    W.shakeAmt = 0;
    W.flashAmt = 0;
    W.caAmt = 0;
    W.peakEnemies = 0;
    W.maxGrooveTier = 0;
    W.perfectStreakBest = 0;
    W.rerolls = (meta && meta.reroll) || 0;
    W.banishes = (meta && meta.banish) || 0;
    W.banished = {};
    W.revives = (meta && meta.revive) || 0;
    W.recChanges = [];
    W.xpDropped = 0;
    W.dmgBy = {};
    W.hurtLog = [];
    W.xpGot = 0;
    W.pendingBig = 0;
    W.bonusNotes = 0;
    W.remixCount = 0;
    W.curI = null;
    W.auraR = 0;
    W.auraPulse = 0;
    W.lastKickT = -9;
    W.addInst(style.start, true);
    W.recompute();
    W.player.hp = W.player.maxHp;
    W.player.charges = W.stats.dashMax;
  };

  function xpFor(l) {
    return Math.round(10 + 6 * l + 0.55 * l * l);
  }
  W.minutes = () => (Seq.S.songSteps * Seq.stepDur()) / 60;
  W.hpMul = (m = W.minutes()) => (1 + 0.3 * m + 0.035 * m * m) * W.diff;
  W.aliveCount = () => W.enemies.length;

  // ---------------------------------------------------------------- 编曲 / 属性
  W.addInst = function (id, silent) {
    W.inst[id] = (W.inst[id] || 0) + 1;
    if (!silent) W.logChange('inst', id, W.inst[id]);
    else W.logChange('inst', id, 1);
    W.syncArr();
  };
  W.addFx = function (id) {
    W.fx[id] = (W.fx[id] || 0) + 1;
    W.logChange('fx', id, W.fx[id]);
    W.recompute();
  };
  W.addRemix = function (id) {
    W.remix[id] = true;
    W.logChange('remix', id, 1);
    W.syncArr();
  };
  W.logChange = function (kind, id, lv) {
    W.log.push({ bar: Math.max(0, Seq.S.bar), s: Seq.S.songSteps, kind, id, lv });
  };
  W.arrangement = function (extra) {
    const a = { inst: Object.assign({}, W.inst), fx: Object.assign({}, W.fx), remix: Object.assign({}, W.remix), groove: W.grooveTier };
    if (extra) {
      if (extra.kind === 'inst') a.inst[extra.id] = (a.inst[extra.id] || 0) + 1;
      else if (extra.kind === 'fx') a.fx[extra.id] = (a.fx[extra.id] || 0) + 1;
      else if (extra.kind === 'remix') a.remix[extra.id] = true;
    }
    return a;
  };
  W.syncArr = function () {
    Seq.S.arr = W.arrangement();
    W.recLog();
  };
  // 唱片：记录编曲变化（按非 hold 步数）
  W.recLog = function () {
    if (!W.recChanges) W.recChanges = [];
    W.recChanges.push({ s: Seq.S.songSteps, arr: JSON.parse(JSON.stringify(Seq.S.arr)) });
  };
  W.recompute = function () {
    const prevMax = W.stats.maxHp;
    W.stats = Effects.compute(W.fx, W.style, W.meta);
    const p = W.player;
    if (p) {
      const dMax = W.stats.maxHp - (prevMax || W.stats.maxHp);
      p.maxHp = W.stats.maxHp;
      if (dMax > 0) p.hp += dMax;
      p.hp = Math.min(p.hp, p.maxHp);
    }
    AE.applyFx(W.fx);
    W.syncArr();
  };
  W.dmgMul = function () {
    return W.stats.dmg * [1, 1.1, 1.2, 1.35][W.grooveTier];
  };

  // ---------------------------------------------------------------- 定时
  W.at = function (t, fn, soundNow) {
    W.atQ.push({ t, fn });
    if (soundNow) soundNow();
  };
  W.later = function (delay, fn) {
    W.atQ.push({ t: W.heard + delay, fn });
  };

  // ---------------------------------------------------------------- 画面反馈
  W.kickPulse = function (v = 1) {
    W.kick = Math.max(W.kick, v);
    W.lastKickT = W.heard;
    R.addRipple(W.player.x, W.player.y, 0.35 * v, 1.1);
    if (W.stats.kickPull) {
      const p = W.player;
      const rr = W.stats.pickup * 2.4;
      for (const g of W.gems) {
        const dx = p.x - g.x, dy = p.y - g.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < rr * rr) {
          const d = Math.sqrt(d2) || 1;
          g.vx += (dx / d) * 260;
          g.vy += (dy / d) * 260;
        }
      }
    }
  };
  W.shake = function (v) {
    W.shakeAmt = Math.max(W.shakeAmt, v * (Game.settings.shake ? 1 : 0));
  };
  W.flash = function (v, col) {
    const k = W.reduceFlash ? 0.25 : 1;
    W.flashAmt = Math.max(W.flashAmt, v * k);
    R.post.flashColor = col || [1, 1, 1];
  };

  // ---------------------------------------------------------------- 生成
  W.spawnEnemy = function (type, x, y, o = {}) {
    const d = ENEMY[type];
    const m = W.minutes();
    const e = enemyPool.pop() || {};
    e.uid = ++uid;
    e.type = type;
    e.def = d;
    e.boss = false;
    e.x = x;
    e.y = y;
    e.elite = !!o.elite;
    e.r = d.r * (e.elite ? 1.9 : 1);
    e.maxHp = e.hp = d.hp * W.hpMul(m) * (e.elite ? 16 : 1);
    e.speed = d.speed * (1 + 0.02 * m) * (e.elite ? 0.85 : 1) * (0.9 + Math.random() * 0.2);
    e.dmg = d.dmg * (e.elite ? 1.5 : 1) * (1 + 0.07 * m);
    e.xp = d.xp * (e.elite ? 25 : 1);
    e.mass = d.mass * (e.elite ? 6 : 1);
    e.kx = 0;
    e.ky = 0;
    e.flash = 0;
    e.slowT = 0;
    e.stunT = 0;
    e.straight = !!o.straight;
    e.vx = o.vx || 0;
    e.vy = o.vy || 0;
    e.rot = Math.random() * TAU;
    e.spawnT = 0.3;
    e.fuseT = 0;
    e.tele = 0;
    e.ring = !!o.ring;
    e.dying = false;
    W.enemies.push(e);
    if (e.elite) W.burst(x, y, ELITE_RGB, 16, 220, 0.6);
    return e;
  };

  W.spawnBoss = function (type) {
    const d = BOSS[type];
    const p = W.player;
    const v = R.view();
    const b = {
      uid: ++uid, type, def: d, boss: true, x: p.x, y: p.y - v.halfH - 120, r: d.r,
      maxHp: d.hp * W.diff, hp: d.hp * W.diff, speed: d.speed, dmg: 20, flash: 0, kx: 0, ky: 0,
      slowT: 0, stunT: 0, tele: 0, mass: 999, spawnT: 0, entering: 1.2, dying: false, xp: 0,
    };
    d.init(b);
    W.enemies.push(b);
    W.bossesAlive().length;
    UI.bossIn(d);
    W.flash(0.5, U.hex(d.color, 1));
    return b;
  };
  W.bossesAlive = () => W.enemies.filter((e) => e.boss && !e.dying);
  W.bossPhase = function (b, ph) {
    W.flash(0.35, [1, 1, 1]);
    W.shake(10);
    R.addRipple(b.x, b.y, 1.5, 1.5);
    W.burst(b.x, b.y, U.hex('#ffffff', 2), 40, 500, 0.8);
    UI.toastBig(ph === 2 ? '第二乐章' : '终章', ph === 2 ? 'MOVEMENT II' : 'FINALE');
  };

  let late = 0;
  function adv(o) {
    if (late > 0) {
      o.x += o.vx * late;
      o.y += o.vy * late;
    }
  }
  W.spawnShot = function (s) {
    s.vx = Math.cos(s.ang) * s.speed;
    s.vy = Math.sin(s.ang) * s.speed;
    s.age = 0;
    s.hit = null;
    s.ox = s.x;
    s.oy = s.y;
    adv(s);
    W.shots.push(s);
  };
  W.spawnHomer = function (h) {
    h.vx = Math.cos(h.ang) * h.speed;
    h.vy = Math.sin(h.ang) * h.speed;
    h.age = 0;
    h.target = null;
    h.lastHit = -1;
    h.bossy = Math.random() < 0.5;
    h.px = h.x;
    h.py = h.y;
    adv(h);
    W.homers.push(h);
  };
  W.spawnBeam = function (b) {
    b.age = late;
    b.hit = new Set();
    b.tickMap = b.tick ? new Map() : null;
    W.beams.push(b);
    W.shake(b.dur > 0.2 ? 1.5 : 0.8);
  };
  W.spawnWave = function (w) {
    w.age = late;
    w.hit = new Set();
    w.r = 0;
    W.waves.push(w);
  };
  W.spawnPillar = function (pl) {
    pl.age = 0;
    W.pillars.push(pl);
    // 立即结算
    const r2 = pl.r * pl.r;
    forTargets(pl.x, pl.y, pl.r, (e) => {
      if (U.dist2(e.x, e.y, pl.x, pl.y) < (pl.r + e.r) * (pl.r + e.r)) {
        W.damage(e, pl.dmg, 0, 0, pl.color);
        if (pl.stun && !e.boss) e.stunT = Seq.beatDur();
      }
    });
    if (pl.burn) W.burns.push({ x: pl.x, y: pl.y, r: pl.r * 0.9, th: 0, t: 0, life: Seq.beatDur() * 2, dmg: pl.dmg * 0.12, tick: 0, disc: true, color: U.hex('#ff8a3c', 1.2) });
    W.burst(pl.x, pl.y, pl.color, 10, 300, 0.35);
    R.addRipple(pl.x, pl.y, 0.5, 1.6);
    W.shake(2.5);
  };
  // 钟琴链：每一跳落在 32 分网格上，音高沿五声音阶上行
  W.spawnChain = function (c) {
    const sd = Seq.stepDur() / 2;
    let x = W.player.x, y = W.player.y;
    const hit = new Set();
    let k = 0;
    const jump = (fromX, fromY, idx, range, branch) => {
      const e = nearestFrom(fromX, fromY, range, hit);
      if (!e) return null;
      hit.add(e.uid);
      W.bolts.push({ x1: fromX, y1: fromY, x2: e.x, y2: e.y, age: 0, life: 0.22, color: c.fork && branch ? U.hex('#c8a0ff', 2.2) : U.hex('#bff4ff', 2.4) });
      W.damage(e, c.dmg, 0, 0, INST.bell.rgb);
      if (c.splash) {
        forTargets(e.x, e.y, c.splash, (o) => {
          if (o !== e && U.dist2(o.x, o.y, e.x, e.y) < c.splash * c.splash) W.damage(o, c.dmg * 0.4, 0, 0, INST.bell.rgb);
        });
      }
      W.burst(e.x, e.y, INST.bell.rgb, 4, 160, 0.25);
      return e;
    };
    const step = () => {
      const e = jump(x, y, k, k === 0 ? 420 : 260, false);
      if (!e) return;
      if (c.fork && k > 0) jump(e.x, e.y, k, 220, true);
      x = e.x;
      y = e.y;
      k++;
      if (k < c.jumps) {
        const tNext = W.heard + sd;
        const m = c.pent[Math.min(c.pent.length - 1, Math.max(0, c.idx + k))];
        Synth.bell(Math.max(Seq.nextGrid32(AE.Clock.sched() + 0.01), 0), m, 0.55, W.style.P.bell);
        W.at(tNext, step);
      }
    };
    step();
  };
  W.enemyShot = function (x, y, ang, speed, r, dmg, col) {
    W.ebullets.push({ x, y, vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed, r, dmg, life: 7, col: col || U.hex('#ff4a3c', 2.2) });
  };

  // Pad 光环
  W.padTick = function (chord, lv, ev) {
    const p = W.player;
    const st = W.stats;
    const R0 = 95 * (lv >= 2 ? 1.2 : 1) * (lv >= 5 ? 1.25 : 1) * st.area * (ev.remix ? 1.4 : 1);
    W.auraR = R0;
    W.auraPulse = chord ? 1 : Math.max(W.auraPulse || 0, 0.35);
    const tick = 3.4 * (lv >= 4 ? 1.5 : 1) * W.dmgMul() * (128 / Seq.S.bpm) * ev.scale;
    const pulse = 13 * (lv >= 6 ? 2 : 1) * W.dmgMul() * ev.scale;
    forTargets(p.x, p.y, R0 + 40, (e) => {
      const rr = R0 + e.r;
      if (U.dist2(e.x, e.y, p.x, p.y) < rr * rr) {
        W.damage(e, chord ? pulse : tick, chord ? 140 : 0, 0, INST.pad.rgb, true);
        if (lv >= 5 && !e.boss) e.slowT = 0.3;
      }
    });
    if (chord) {
      if (lv >= 3 && ev.I.barIn % 2 === 0) p.shield = Math.min(ev.remix ? 2 : 1, p.shield + 1);
      if (lv >= 6) p.hp = Math.min(p.maxHp, p.hp + 2);
      W.waves.push({ x: p.x, y: p.y, maxR: R0 * 1.15, dur: 0.35, dmg: 0, knock: 0, color: INST.pad.rgb, age: 0, hit: new Set(), r: 0, visualOnly: true });
    }
  };

  // ---------------------------------------------------------------- 查询
  function forTargets(x, y, r, fn) {
    grid.query(x, y, r + 50, (e) => { if (!e.dying && !e.boss) fn(e); });
    for (const e of W.enemies) if (e.boss && !e.dying && !e.entering) fn(e);
  }
  W.forTargets = forTargets;
  function nearestFrom(x, y, range, exclude) {
    let best = null, bd = range * range;
    grid.query(x, y, range, (e) => {
      if (e.dying || e.boss || (exclude && exclude.has(e.uid))) return;
      const d = U.dist2(e.x, e.y, x, y);
      if (d < bd) { bd = d; best = e; }
    });
    for (const e of W.enemies) {
      if (!e.boss || e.dying || e.entering || (exclude && exclude.has(e.uid))) continue;
      const d = U.dist2(e.x, e.y, x, y) - e.r * e.r;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  W.nearestEnemy = (x, y, range) => nearestFrom(x, y, range, null);
  W.randomEnemyNear = function (x, y, range) {
    tmp.length = 0;
    grid.query(x, y, range, (e) => {
      if (!e.dying && U.dist2(e.x, e.y, x, y) < range * range) tmp.push(e);
    });
    for (const e of W.enemies) if (e.boss && !e.dying && !e.entering && U.dist2(e.x, e.y, x, y) < range * range) tmp.push(e);
    if (!tmp.length) return null;
    // 偏向密集处：随机取几个，选周围最多的
    let best = tmp[Math.floor(Math.random() * tmp.length)];
    return best;
  };

  // ---------------------------------------------------------------- 伤害 / 击杀
  W.damage = function (e, dmg, kx, ky, col, quiet) {
    if (e.dying || e.entering) return;
    let crit = false;
    if (W.stats.crit > 0 && Math.random() < W.stats.crit) {
      dmg *= 2;
      crit = true;
    }
    e.hp -= dmg;
    e.flash = 1;
    if (!e.boss) {
      const k = 1 / Math.max(0.5, e.mass);
      e.kx += kx * k;
      e.ky += ky * k;
    }
    if (crit) W.burst(e.x, e.y, U.hex('#fff27a', 2.5), 5, 260, 0.25);
    else if (!quiet && Math.random() < 0.5) W.spark(e.x, e.y, col);
    if (e.hp <= 0) W.kill(e);
  };

  W.kill = function (e) {
    if (e.dying) return;
    e.dying = true;
    // 量化：下一个 16 分音符上爆炸
    const tq = Seq.nextGrid(Math.max(W.heard + 0.001, AE.Clock.sched() + 0.012));
    e.dieT = tq;
    W.dying.push(e);
    W.kills++;
    W.groove = Math.min(100, W.groove + 0.12);
    // 击杀玻璃音（每个 16 分最多 2 个）
    const slot = Math.round((tq - Seq.S.t0) / Seq.stepDur());
    const c = hitSlots.get(slot) || 0;
    if (c < 2 && !W.outroSilence) {
      hitSlots.set(slot, c + 1);
      const I = W.curI;
      if (I) {
        // 取当前和弦的和弦音，满屏割草时也协和
        const pool = Harmony.chordNotesInRange(I.chord, 79, 96);
        const m = pool[(slot * 3 + c * 2) % pool.length];
        Synth.glass(tq, m, e.boss ? 1.5 : 0.7 + Math.random() * 0.3);
      }
    }
    if (hitSlots.size > 64) {
      for (const k of hitSlots.keys()) if (k < slot - 32) hitSlots.delete(k);
    }
    if (e.boss) W.onBossKilled(e);
  };

  function explode(e) {
    const col = e.boss ? U.hex(e.def.color, 2.5) : e.elite ? ELITE_RGB : e.def.rgbHot;
    const n = e.boss ? 80 : e.elite ? 30 : e.type === 'sub' ? 14 : 8;
    W.burst(e.x, e.y, col, n, e.boss ? 700 : 260 + e.r * 6, e.boss ? 1.2 : 0.45);
    W.parts.push(mkPart(e.x, e.y, 0, 0, e.r * 0.6, e.boss ? 0.8 : 0.28, HOT_WHITE, SH.RING, 0, e.r * 3.2));
    if (!e.boss) {
      dropGem(e.x, e.y, e.xp);
      const roll = Math.random();
      if (e.elite) {
        W.pickups.push({ kind: 'chest', x: e.x, y: e.y, age: 0 });
        W.pickups.push({ kind: 'heal', x: e.x + 30, y: e.y, age: 0 });
      } else if (roll < 0.004) W.pickups.push({ kind: 'heal', x: e.x, y: e.y, age: 0 });
      else if (roll < 0.0055) W.pickups.push({ kind: 'magnet', x: e.x, y: e.y, age: 0 });
    }
    if (e.type === 'sub' || e.elite) W.shake(2);
  }

  function dropGem(x, y, v) {
    W.xpDropped = (W.xpDropped || 0) + v;
    if (W.gems.length > 380) {
      // 太多就并入附近的宝石（抽样找最近的一颗）
      let best = null, bd = 1e12;
      for (let k = 0; k < 24; k++) {
        const g = W.gems[Math.floor(Math.random() * W.gems.length)];
        const d = U.dist2(g.x, g.y, x, y);
        if (d < bd) { bd = d; best = g; }
      }
      if (bd < 250 * 250) {
        best.v += v;
        return;
      }
      // 附近没有：把最老的一颗挪过来合并
      const old = W.gems.shift();
      old.x = x; old.y = y; old.v += v; old.mag = false; old.vx = old.vy = 0;
      W.gems.push(old);
      return;
    }
    const a = Math.random() * TAU;
    W.gems.push({ x, y, v, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60, mag: false, age: 0 });
  }

  W.onBossKilled = function (b) {
    W.bossKills.push(b.type);
    W.flash(0.9, [1, 1, 1]);
    W.shake(18);
    W.punch = 0.12;
    for (let i = 0; i < 6; i++) {
      W.later(i * Seq.stepDur() * 2, () => {
        W.burst(b.x + (Math.random() - 0.5) * 160, b.y + (Math.random() - 0.5) * 160, U.hsl(Math.random(), 0.9, 0.6, 2.5), 30, 600, 0.9);
        R.addRipple(b.x, b.y, 1.5, 1.2);
      });
    }
    Synth.crash(Seq.gridSound(), 1, {});
    Synth.impact(Seq.gridSound(), 1);
    UI.bossDown(b.def);
    if (b.type === 'conductor') {
      Seq.S.flags.outroRequested = true;
      UI.banner('谢幕', 'BRAVO');
      for (const e of W.enemies) if (!e.boss) e.speed *= 0.5;
    } else {
      W.pickups.push({ kind: 'chest', x: b.x, y: b.y, age: 0, big: true });
      for (let i = 0; i < 12; i++) dropGem(b.x + (Math.random() - 0.5) * 120, b.y + (Math.random() - 0.5) * 120, 12);
    }
  };

  // ---------------------------------------------------------------- 玩家
  W.tryDash = function (perfMs, simErr = 0) {
    const p = W.player;
    if (!p.alive || W.frozen || W.over) return;
    if (p.charges <= 0 || p.dashT > 0) {
      return;
    }
    const hT = AE.Clock.fromPerf(perfMs) + simErr;
    const nb = Seq.nearestBeat(hT);
    const off = hT - nb.t;
    const win = W.stats.window;
    let grade = 'miss';
    if (Math.abs(off) <= win) grade = 'perfect';
    else if (Math.abs(off) <= win * 2) grade = 'good';
    let dx = W.input.x, dy = W.input.y;
    if (Math.abs(dx) + Math.abs(dy) < 0.1) { dx = Math.cos(p.face); dy = Math.sin(p.face); }
    const l = Math.hypot(dx, dy) || 1;
    const spd = 1250;
    p.dashVX = (dx / l) * spd;
    p.dashVY = (dy / l) * spd;
    p.dashT = 0.135;
    p.dashPerfect = grade === 'perfect';
    if (grade !== 'perfect') p.charges--;
    if (p.charges < W.stats.dashMax && p.rech <= 0) p.rech = 2 * Seq.beatDur() * W.stats.dashRech;
    W.dashes++;
    if (grade === 'perfect') {
      W.perfects++;
      W.combo++;
      W.maxCombo = Math.max(W.maxCombo, W.combo);
      W.groove = Math.min(100, W.groove + 15);
      const I = W.curI;
      const t = AE.Clock.sched() + 0.004;
      if (I) {
        const ct = Harmony.chordNotesInRange(I.chord, 79, 91).slice(0, 3);
        Synth.perfect(t, ct);
      }
    } else if (grade === 'good') {
      W.goods++;
      W.combo = 0;
      W.groove = Math.min(100, W.groove + 5);
    } else {
      W.combo = 0;
    }
    Synth.dash(AE.Clock.sched() + 0.003, grade === 'perfect');
    p.judge = { grade, off, t: 0.7 };
    UI.judge(grade, off, W.combo);
    Debug.judge(off);
  };

  W.hurt = function (dmg, srcX, srcY, src = '?') {
    const p = W.player;
    if (!p.alive || p.invuln > 0 || p.dashT > 0 || W.outro || W.god) return;
    if (p.shield > 0) {
      p.shield--;
      p.invuln = 0.45;
      W.burst(p.x, p.y, INST.pad.rgb, 18, 300, 0.4);
      R.addRipple(p.x, p.y, 0.6, 1.5);
      Synth.perfect(AE.Clock.sched() + 0.004, [74, 81]);
      return;
    }
    dmg *= W.stats.armor;
    p.hp -= dmg;
    W.dmgTaken += dmg;
    W.dmgBy[src] = (W.dmgBy[src] || 0) + Math.round(dmg);
    W.hurtLog.push(`${W.minutes().toFixed(2)} ${src} ${Math.round(dmg)} hp${Math.round(p.hp)}`);
    if (W.hurtLog.length > 12) W.hurtLog.shift();
    p.invuln = 0.8;
    p.hitFlash = 1;
    W.groove = Math.max(0, W.groove - 25);
    W.combo = 0;
    AE.hitDip(1);
    Synth.hurt(AE.Clock.sched() + 0.004);
    R.post.hurt = 1;
    W.caAmt = Math.max(W.caAmt, 0.012);
    W.shake(9);
    if (srcX !== undefined) {
      const a = Math.atan2(p.y - srcY, p.x - srcX);
      p.vx += Math.cos(a) * 300;
      p.vy += Math.sin(a) * 300;
    }
    if (p.hp <= 0) {
      if (W.revives > 0) {
        W.revives--;
        p.hp = p.maxHp * 0.5;
        p.invuln = 2.5;
        W.spawnWave({ x: p.x, y: p.y, maxR: 900, dur: 0.6, dmg: 200 * W.hpMul(), knock: 900, color: [3, 3, 3], inst: 'revive' });
        W.flash(0.7, [1, 0.9, 0.6]);
        UI.toastBig('安可！', 'ENCORE');
        return;
      }
      p.hp = 0;
      p.alive = false;
      W.over = true;
      W.burst(p.x, p.y, U.hex(W.style.color, 3), 80, 600, 1.2);
      Game.onDeath();
    }
  };

  W.heal = function (v) {
    const p = W.player;
    p.hp = Math.min(p.maxHp, p.hp + v);
  };

  // ---------------------------------------------------------------- 事件处理
  const evBuf = [];
  W.processEvents = function () {
    Seq.popDue(W.heard, evBuf);
    for (const ev of evBuf) {
      if (ev.type === 'step') {
        onStepVisual(ev);
        Debug.late(W.heard - ev.t);
      }
      const live = !W.frozen && !ev.held && W.heard >= W.resumeT && !W.over;
      if (ev.type === 'inst') {
        W.instFlash[ev.id] = 1;
        if (live) fireInst(ev);
      } else if (ev.type === 'step') {
        if (live) onStepGame(ev);
      } else if (ev.type === 'end') {
        if (!W.over) Game.onVictory();
      }
    }
  };

  function fireInst(ev) {
    const def = INST[ev.id];
    late = U.clamp(W.heard - ev.t, 0, 0.05);
    ev.scale = 1;
    ev.ghost = false;
    def.fire(ev.n, ev.lv, ev);
    if (W.stats.echo > 0 && ev.id !== 'pad' && Math.random() < W.stats.echo) {
      const echo = Object.assign({}, ev, { scale: 0.5, ghost: true });
      W.at(ev.t + 3 * Seq.stepDur(), () => {
        late = 0;
        def.fire(echo.n, echo.lv, echo);
      });
    }
    late = 0;
  }

  function onStepVisual(ev) {
    W.curI = ev.I;
    if (ev.pos % 4 === 0) {
      W.lastBeatT = ev.t;
      W.beatIdx = ev.pos / 4;
    }
  }

  function onStepGame(ev) {
    const I = ev.I;
    const sec = I.sec;
    if (sec.idx !== W.secIdx) {
      const prev = W.secIdx >= 0 ? Song.S.sections[W.secIdx] : null;
      W.secIdx = sec.idx;
      onSection(sec, prev);
    }
    if (ev.bar !== W.bar) {
      if (sec.final && W.bar >= 0 && ev.bar < W.bar && Song.sectionAt(W.bar).final) {
        UI.banner('加时', 'OVERTIME ×' + (Seq.S.flags.overtime || 1));
        W.flash(0.3, U.hex('#ff3c7a', 1));
      }
      W.bar = ev.bar;
      // 每小节回血（曲风被动 / 母带）
      if (W.stats.regen > 0) W.heal(W.stats.regen);
    }
    // 铺垫最后一小节倒数
    if (sec.type === 'build' && I.lastBar) {
      if (ev.pos === 0) UI.countdown('3');
      else if (ev.pos === 4) UI.countdown('2');
      else if (ev.pos === 8) UI.countdown('1');
      else if (ev.pos === 12) { UI.countdown(''); W.caAmt = Math.max(W.caAmt, 0.006); }
    }
    // 律动 III：每拍回血
    if (W.grooveTier >= 3 && ev.pos % 4 === 0) W.heal(0.25);
    Director.onStep(ev);
    // 节拍器敌人：第 3 拍预警，第 4 拍开火（木鱼声在那一拍上）
    if (ev.pos === 8) {
      let any = false;
      for (const e of W.enemies) {
        if (e.type === 'ticker' && !e.dying && onScreen(e.x, e.y, 40)) {
          e.tele = 1;
          any = true;
        }
      }
      if (any) {
        const t = ev.t + Seq.beatDur();
        W.at(t, () => {
          for (const e of W.enemies) {
            if (e.type === 'ticker' && !e.dying && e.tele > 0) {
              const a = Math.atan2(W.player.y - e.y, W.player.x - e.x);
              W.enemyShot(e.x, e.y, a, 230, 7, 9, U.hex('#ffd23c', 2.4));
              e.tele = 0;
            }
          }
        }, () => Synth.woodblock(t, 0.9));
      }
    }
    for (const e of W.enemies) if (e.boss && !e.dying && !e.entering && !e.leaving) e.def.onStep(e, ev);
    // 尾声：按拍溶解残余敌人
    if (W.outro && ev.pos % 2 === 0) {
      let n = Math.ceil(W.enemies.length * 0.18);
      for (let i = W.enemies.length - 1; i >= 0 && n > 0; i--) {
        const e = W.enemies[i];
        if (!e.dying && !e.boss) {
          W.kill(e);
          n--;
        }
      }
      for (const g of W.gems) g.mag = true;
    }
  }

  function onSection(sec, prev) {
    const st = SECTION_TYPES[sec.type];
    if (sec.type === 'drop') W.dropBlast(sec);
    else UI.banner(st.name, st.en);
    // 上一段的 Boss 退场
    if (prev && prev.boss && !prev.final) {
      for (const e of W.enemies) {
        if (e.boss && e.type === prev.boss && !e.dying) {
          e.leaving = 1.5;
          UI.toastBig(e.def.name + ' 退场', 'EXIT');
        }
      }
    }
    if (sec.boss) W.later(Seq.beatDur() * 2, () => W.spawnBoss(sec.boss));
    if (sec.type === 'outro') {
      W.outro = true;
      W.hazards.length = 0;
      W.ebullets.length = 0;
    }
    UI.section(sec);
  }

  W.dropBlast = function (sec) {
    const p = W.player;
    const m = W.minutes();
    W.spawnWave({ x: p.x, y: p.y, maxR: 1500, dur: 0.55, dmg: 55 * W.hpMul(m), knock: 700, color: U.hex(W.style.color, 2.5), inst: 'drop' });
    W.flash(0.7, [1, 1, 1]);
    W.caAmt = 0.03;
    W.punch = 0.1;
    W.shake(16);
    R.addRipple(p.x, p.y, 2.5, 1.0);
    W.burst(p.x, p.y, U.hex(W.style.color, 3), 70, 900, 0.9);
    UI.banner(sec.final ? '终极爆发' : '爆发', sec.final ? 'FINAL DROP' : 'DROP', true);
    W.hazards.length = 0;
  };

  // ---------------------------------------------------------------- 模拟一步
  W.step = function (dt) {
    W.time += dt;
    const p = W.player;
    const st = W.stats;
    // 拍子涌动
    const ph = Seq.beatPhase(W.heard);
    W.beatMove = 0.82 + 0.9 * Math.exp(-5 * ph);

    // 玩家移动
    const ix = W.input.x, iy = W.input.y;
    const il = Math.hypot(ix, iy);
    p.moving = il > 0.1;
    if (p.moving) p.face = Math.atan2(iy, ix);
    if (p.dashT > 0) {
      p.dashT -= dt;
      p.x += p.dashVX * dt;
      p.y += p.dashVY * dt;
      if (Math.random() < 0.9) W.parts.push(mkPart(p.x, p.y, -p.dashVX * 0.05, -p.dashVY * 0.05, 9, 0.25, U.hex(W.style.color, p.dashPerfect ? 2.5 : 1.2), W.style.shape, p.face, 0));
      if (p.dashT <= 0) {
        p.vx = p.dashVX * 0.2;
        p.vy = p.dashVY * 0.2;
        if (p.dashPerfect) {
          const dmg = (12 + W.level * 2.2) * W.dmgMul();
          W.spawnWave({ x: p.x, y: p.y, maxR: 120 * st.area, dur: 0.2, dmg, knock: 380, color: U.hex(W.style.color, 2.2), inst: 'dash' });
          R.addRipple(p.x, p.y, 0.6, 1.4);
        }
      }
    } else {
      const sp = st.speed;
      const tx = il > 0.1 ? (ix / Math.max(1, il)) * sp : 0;
      const ty = il > 0.1 ? (iy / Math.max(1, il)) * sp : 0;
      p.vx = U.damp(p.vx, tx, 14, dt);
      p.vy = U.damp(p.vy, ty, 14, dt);
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    if (p.invuln > 0) p.invuln -= dt;
    if (p.hitFlash > 0) p.hitFlash -= dt * 3;
    if (p.charges < st.dashMax) {
      p.rech -= dt;
      if (p.rech <= 0) {
        p.charges++;
        p.rech = p.charges < st.dashMax ? 2 * Seq.beatDur() * st.dashRech : 0;
      }
    }
    // 律动衰减
    W.groove = Math.max(0, W.groove - 3 * dt * (W.stats.grooveDecay || 1));
    const tier = W.groove >= 90 ? 3 : W.groove >= 60 ? 2 : W.groove >= 30 ? 1 : 0;
    if (tier !== W.grooveTier) {
      if (tier > W.grooveTier) UI.grooveUp(tier);
      W.grooveTier = tier;
      W.maxGrooveTier = Math.max(W.maxGrooveTier, tier);
      W.syncArr();
    }

    // 空间网格
    const en = W.enemies;
    grid.build(en, en.length, p.x, p.y);
    if (en.length > W.peakEnemies) W.peakEnemies = en.length;

    updateEnemies(dt);
    updateShots(dt);
    updateHomers(dt);
    updateBeams(dt);
    updateWaves(dt);
    updateBurns(dt);
    updateHazards(dt);
    updateGems(dt);
    updatePickups(dt);
    updateAura(dt);

    // 量化死亡
    for (let i = W.dying.length - 1; i >= 0; i--) {
      const e = W.dying[i];
      if (W.heard >= e.dieT) {
        explode(e);
        W.dying.splice(i, 1);
        const idx = en.indexOf(e);
        if (idx >= 0) { en[idx] = en[en.length - 1]; en.pop(); }
        if (!e.boss) enemyPool.push(e);
      }
    }
    // 延时动作
    for (let i = 0; i < W.atQ.length; i++) {
      const a = W.atQ[i];
      if (W.heard >= a.t) {
        W.atQ.splice(i, 1);
        i--;
        a.fn();
      }
    }
    // 升级
    while (W.xp >= W.xpNext) {
      W.xp -= W.xpNext;
      W.level++;
      W.xpNext = xpFor(W.level);
      W.pendingLevels++;
    }
  };

  function onScreen(x, y, m = 0) {
    const v = R.view();
    return Math.abs(x - R.cam.x) < v.halfW + m && Math.abs(y - R.cam.y) < v.halfH + m;
  }
  W.onScreen = onScreen;

  function updateEnemies(dt) {
    const p = W.player;
    const en = W.enemies;
    const bm = W.beatMove;
    const pr = 14;
    for (let i = 0; i < en.length; i++) {
      const e = en[i];
      if (e.dying) continue;
      if (e.flash > 0) e.flash -= dt * 6;
      if (e.tele > 0) e.tele -= dt * 1.5;
      if (e.spawnT > 0) e.spawnT -= dt;
      if (e.boss) {
        if (e.entering > 0) {
          e.entering -= dt;
          e.y = U.damp(e.y, p.y - 240, 3, dt);
          e.x = U.damp(e.x, p.x, 3, dt);
          if (e.entering <= 0) e.entering = 0;
          continue;
        }
        if (e.leaving) {
          e.leaving -= dt;
          e.y -= 500 * dt;
          if (e.leaving <= 0) { en.splice(i, 1); i--; UI.bossGone(e.def); }
          continue;
        }
        e.def.update(e, dt);
        const rr = e.r + pr;
        if (U.dist2(e.x, e.y, p.x, p.y) < rr * rr) W.hurt(e.dmg, e.x, e.y, 'boss');
        continue;
      }
      if (e.stunT > 0) { e.stunT -= dt; continue; }
      let mx = 0, my = 0;
      if (e.straight) {
        mx = e.vx;
        my = e.vy;
      } else {
        const dx = p.x - e.x, dy = p.y - e.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 1;
        let sp = e.speed * bm * (e.slowT > 0 ? 0.5 : 1);
        if (W.outro) sp *= 0.3;
        if (e.type === 'ticker') {
          if (d < 300) sp = -sp * 0.7;
          else if (d < 400) {
            mx = (-dy / d) * sp * 0.5;
            my = (dx / d) * sp * 0.5;
            sp = 0;
          }
        }
        mx += (dx / d) * sp;
        my += (dy / d) * sp;
        if (e.type === 'feedback' && !e.fuseT && d < 120) {
          // 引信：在下一拍爆炸
          e.fuseT = 1;
          const nb = Seq.nextGrid(W.heard + 0.25);
          const bd = Seq.beatDur();
          const tb = Seq.S.t0 + Math.ceil((nb - Seq.S.t0) / bd) * bd;
          const ee = e;
          W.at(tb, () => {
            if (ee.dying) return;
            W.burst(ee.x, ee.y, U.hex('#ff6a3c', 2.5), 22, 380, 0.4);
            W.parts.push(mkPart(ee.x, ee.y, 0, 0, 20, 0.3, U.hex('#ff8a4a', 2), SH.RING, 0, 110));
            if (U.dist2(ee.x, ee.y, W.player.x, W.player.y) < 105 * 105) W.hurt(16, ee.x, ee.y, 'feedback');
            ee.xp = 0;
            W.kill(ee);
          }, () => Synth.snare(Math.max(tb, AE.Clock.sched() + 0.01), 0.7, W.style.P.snare));
        }
      }
      if (e.slowT > 0) e.slowT -= dt;
      e.x += (mx + e.kx) * dt;
      e.y += (my + e.ky) * dt;
      const kd = Math.exp(-9 * dt);
      e.kx *= kd;
      e.ky *= kd;
      e.rot += dt * (e.type === 'glitch' ? 6 : 1.2);
      // 互斥
      const er = e.r;
      grid.query(e.x, e.y, er + 30, (o) => {
        if (o === e || o.dying) return;
        const dx = e.x - o.x, dy = e.y - o.y;
        const rr = er + o.r;
        const d2 = dx * dx + dy * dy;
        if (d2 < rr * rr && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const push = ((rr - d) / d) * 0.5 * (o.mass / (e.mass + o.mass));
          e.x += dx * push;
          e.y += dy * push;
        }
      });
      // 撞玩家
      const rr = er + pr;
      const dpx = e.x - p.x, dpy = e.y - p.y;
      const d2p = dpx * dpx + dpy * dpy;
      if (d2p < rr * rr && e.spawnT <= 0.15) W.hurt(e.dmg, e.x, e.y, e.elite ? 'elite' : e.type);
      // 太远的回收到前方
      if (d2p > 1750 * 1750) {
        if (e.straight) {
          en.splice(i, 1);
          i--;
          enemyPool.push(e);
        } else {
          const sp = Director.spawnPoint(60);
          e.x = sp.x;
          e.y = sp.y;
        }
      }
    }
  }

  function hitTest(x, y, r, fn) {
    forTargets(x, y, r, (e) => {
      const rr = r + e.r;
      if (U.dist2(e.x, e.y, x, y) < rr * rr) return fn(e);
    });
  }

  function updateShots(dt) {
    const S = W.shots;
    for (let i = S.length - 1; i >= 0; i--) {
      const s = S[i];
      s.age += dt;
      let x = s.x + s.vx * dt, y = s.y + s.vy * dt;
      if (s.wave) {
        // 正弦轨迹：沿速度法线偏移
        const sp = Math.hypot(s.vx, s.vy) || 1;
        const nx = -s.vy / sp, ny = s.vx / sp;
        const o1 = Math.sin(s.age * 9) * s.waveAmp * s.wave;
        const o0 = Math.sin((s.age - dt) * 9) * s.waveAmp * s.wave;
        x += nx * (o1 - o0);
        y += ny * (o1 - o0);
      }
      s.x = x;
      s.y = y;
      if (s.sparks && Math.random() < dt * 14) {
        W.spawnWave({ x, y, maxR: 40, dur: 0.15, dmg: s.dmg * 0.25, knock: 0, color: s.color, inst: 'stab' });
      }
      if (s.trail && Math.random() < dt * 9) {
        W.burns.push({ x, y, r: s.r * 1.1, th: 0, t: 0, life: 0.45, dmg: s.dmg * 0.15, tick: 0, disc: true, color: s.color, small: true });
      }
      let dead = s.age >= s.life;
      if (!dead) {
        hitTest(x, y, s.r, (e) => {
          if (!s.hit) s.hit = new Set();
          if (s.hit.has(e.uid)) return;
          s.hit.add(e.uid);
          const sp = Math.hypot(s.vx, s.vy) || 1;
          W.damage(e, s.dmg, (s.vx / sp) * 90, (s.vy / sp) * 90, s.color);
          if (s.split) {
            for (let k = 0; k < 4; k++) {
              const a = Math.atan2(s.vy, s.vx) + (k - 1.5) * 0.5;
              W.spawnShot({ x, y, ang: a, speed: 600, r: 4, len: 10, dmg: s.dmg * 0.4, pierce: 0, life: 0.3, color: s.color, shape: 6, inst: s.inst });
            }
          }
          if (s.pierce-- <= 0) {
            dead = true;
            return true;
          }
        });
      }
      if (dead) {
        if (s.explode || s.gated) {
          const rr = s.explode || 70 * W.stats.area;
          W.spawnWave({ x: s.x, y: s.y, maxR: rr, dur: 0.18, dmg: s.dmg * (s.gated ? 0.8 : 0.6), knock: 120, color: s.color, inst: s.inst });
        }
        S[i] = S[S.length - 1];
        S.pop();
      }
    }
  }

  function updateHomers(dt) {
    const H = W.homers;
    for (let i = H.length - 1; i >= 0; i--) {
      const h = H[i];
      h.age += dt;
      h.px = h.x;
      h.py = h.y;
      if (!h.target || h.target.dying || h.age % 0.25 < dt) {
        // 一半的追踪弹优先找 Boss
        const boss = h.bossy ? W.enemies.find((e) => e.boss && !e.dying && !e.entering && !e.leaving && U.dist2(e.x, e.y, h.x, h.y) < 700 * 700) : null;
        h.target = boss || nearestFrom(h.x, h.y, 600, h.lastHit >= 0 ? new Set([h.lastHit]) : null);
      }
      const sp = h.speed * (1 + Math.min(1, h.age * 1.5) * 0.5);
      let ang = Math.atan2(h.vy, h.vx);
      if (h.target) {
        const want = Math.atan2(h.target.y - h.y, h.target.x - h.x);
        const da = U.angleDiff(want, ang);
        const maxTurn = h.turn * dt * (h.age < 0.12 ? 0.3 : 1);
        ang += U.clamp(da, -maxTurn, maxTurn);
      }
      h.vx = Math.cos(ang) * sp;
      h.vy = Math.sin(ang) * sp;
      h.x += h.vx * dt;
      h.y += h.vy * dt;
      let dead = h.age >= h.life;
      if (!dead) {
        hitTest(h.x, h.y, h.r, (e) => {
          if (e.uid === h.lastHit) return;
          W.damage(e, h.dmg, h.vx * 0.12, h.vy * 0.12, h.color);
          W.burst(h.x, h.y, h.color, 4, 180, 0.25);
          if (h.bounce > 0) {
            h.bounce--;
            h.lastHit = e.uid;
            h.target = null;
            h.age = Math.min(h.age, h.life - 0.8);
            h.midi += 2;
            Synth.pluck(Seq.gridSound(), h.midi, Seq.stepDur(), 0.4, W.style.P.pluck, 0);
            h.color = U.pitchColor(h.midi, 1);
          } else dead = true;
          return true;
        });
      }
      if (dead) {
        H[i] = H[H.length - 1];
        H.pop();
      }
    }
  }

  function segDist2(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy || 1;
    const t = U.clamp(((px - x1) * dx + (py - y1) * dy) / l2, 0, 1);
    const qx = x1 + dx * t, qy = y1 + dy * t;
    return U.dist2(px, py, qx, qy);
  }

  function beamGeom(b) {
    const p = W.player;
    const f = U.clamp(b.age / b.dur, 0, 1);
    let ang = b.ang + (b.sweep || 0) * f;
    if (b.wobble) ang += Math.sin(b.age * 14) * 0.35;
    const x1 = p.x, y1 = p.y;
    return { x1, y1, x2: x1 + Math.cos(ang) * b.len, y2: y1 + Math.sin(ang) * b.len, ang };
  }

  function updateBeams(dt) {
    const B = W.beams;
    for (let i = B.length - 1; i >= 0; i--) {
      const b = B[i];
      b.age += dt;
      if (b.age >= b.dur + 0.12) {
        B[i] = B[B.length - 1];
        B.pop();
        continue;
      }
      if (b.age > b.dur || b.dmg <= 0) continue;
      const g = beamGeom(b);
      const mx = (g.x1 + g.x2) / 2, my = (g.y1 + g.y2) / 2;
      const w = b.width;
      forTargets(mx, my, b.len / 2 + w, (e) => {
        const rr = w / 2 + e.r;
        if (segDist2(e.x, e.y, g.x1, g.y1, g.x2, g.y2) > rr * rr) return;
        if (b.pull && !e.boss) {
          const nx = -Math.sin(g.ang), ny = Math.cos(g.ang);
          const side = (e.x - g.x1) * nx + (e.y - g.y1) * ny;
          e.kx -= nx * Math.sign(side) * 300 * dt;
          e.ky -= ny * Math.sign(side) * 300 * dt;
        }
        if (b.tickMap) {
          const lt = b.tickMap.get(e.uid);
          if (lt !== undefined && b.age - lt < b.tick) return;
          const first = lt === undefined;
          b.tickMap.set(e.uid, b.age);
          W.damage(e, first ? b.dmg : b.tickDmg, Math.cos(g.ang) * 40, Math.sin(g.ang) * 40, b.color, !first);
        } else {
          if (b.hit.has(e.uid)) return;
          b.hit.add(e.uid);
          W.damage(e, b.dmg, Math.cos(g.ang) * 80, Math.sin(g.ang) * 80, b.color);
        }
      });
    }
  }

  function updateWaves(dt) {
    const Wv = W.waves;
    for (let i = Wv.length - 1; i >= 0; i--) {
      const w = Wv[i];
      w.age += dt;
      const f = U.clamp(w.age / w.dur, 0, 1);
      const r = w.maxR * (1 - Math.pow(1 - f, 2.2));
      w.r = r;
      if (!w.visualOnly && w.dmg > 0) {
        forTargets(w.x, w.y, r, (e) => {
          if (w.hit.has(e.uid)) return;
          const dx = e.x - w.x, dy = e.y - w.y;
          const rr = r + e.r;
          const d2 = dx * dx + dy * dy;
          if (d2 > rr * rr) return;
          w.hit.add(e.uid);
          const d = Math.sqrt(d2) || 1;
          W.damage(e, w.dmg, (dx / d) * w.knock, (dy / d) * w.knock, w.color);
          if (w.slow && !e.boss) e.slowT = Seq.beatDur();
        });
      }
      if (f >= 1) {
        if (w.burn) W.burns.push({ x: w.x, y: w.y, r: w.maxR, th: 16, t: 0, life: Seq.beatDur(), dmg: w.dmg * 0.18, tick: 0, color: U.hex('#ff6a2a', 1.6) });
        Wv[i] = Wv[Wv.length - 1];
        Wv.pop();
      }
    }
  }

  function updateBurns(dt) {
    const B = W.burns;
    for (let i = B.length - 1; i >= 0; i--) {
      const b = B[i];
      b.t += dt;
      b.tick -= dt;
      if (b.tick <= 0) {
        b.tick = 0.15;
        forTargets(b.x, b.y, b.r + b.th, (e) => {
          const d = Math.sqrt(U.dist2(e.x, e.y, b.x, b.y));
          if (b.disc ? d < b.r + e.r : Math.abs(d - b.r) < b.th + e.r) W.damage(e, b.dmg, 0, 0, b.color, true);
        });
      }
      if (b.t >= b.life) {
        B[i] = B[B.length - 1];
        B.pop();
      }
    }
  }

  function updateHazards(dt) {
    const p = W.player;
    const pr = 12;
    const Hz = W.hazards;
    for (let i = Hz.length - 1; i >= 0; i--) {
      const h = Hz[i];
      let dead = false;
      if (h.kind === 'ring') {
        h.r += h.speed * dt;
        if (!h.hit) {
          const d = Math.sqrt(U.dist2(p.x, p.y, h.x, h.y));
          if (Math.abs(d - h.r) < h.thick + pr) {
            const a = Math.atan2(p.y - h.y, p.x - h.x);
            if (Math.abs(U.angleDiff(a, h.gap)) > h.gapHalf) {
              h.hit = true;
              W.hurt(h.dmg, h.x, h.y, 'ring');
            }
          }
        }
        if (h.r > h.maxR) dead = true;
      } else if (h.kind === 'laser') {
        if (W.heard >= h.fireUntil) dead = true;
        else if (W.heard >= h.warnUntil && !h.hit) {
          const nx = -Math.sin(h.ang), ny = Math.cos(h.ang);
          const d = Math.abs((p.x - h.x) * nx + (p.y - h.y) * ny);
          if (d < h.width / 2 + pr) {
            h.hit = true;
            W.hurt(h.dmg, p.x - nx * 10, p.y - ny * 10, 'laser');
          }
        }
      }
      if (dead) Hz.splice(i, 1);
    }
    const E = W.ebullets;
    for (let i = E.length - 1; i >= 0; i--) {
      const b = E[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      const rr = b.r + pr;
      let dead = b.life <= 0;
      if (!dead && U.dist2(b.x, b.y, p.x, p.y) < rr * rr) {
        if (p.dashT <= 0 && p.invuln <= 0) {
          W.hurt(b.dmg, b.x, b.y, 'bullet');
          dead = true;
        }
      }
      if (dead) {
        E[i] = E[E.length - 1];
        E.pop();
      }
    }
  }

  function updateGems(dt) {
    const p = W.player;
    const G = W.gems;
    const pk = W.stats.pickup * (W.grooveTier >= 2 ? 1.3 : 1);
    const pk2 = pk * pk;
    for (let i = G.length - 1; i >= 0; i--) {
      const g = G[i];
      g.age += dt;
      const dx = p.x - g.x, dy = p.y - g.y;
      const d2 = dx * dx + dy * dy;
      if (!g.mag && d2 < pk2) g.mag = true;
      if (g.mag) {
        const d = Math.sqrt(d2) || 1;
        const acc = 2600 + g.age * 200;
        g.vx += (dx / d) * acc * dt;
        g.vy += (dy / d) * acc * dt;
        const sp = Math.hypot(g.vx, g.vy);
        const max = 1400;
        if (sp > max) { g.vx *= max / sp; g.vy *= max / sp; }
      }
      const kd = Math.exp(-(g.mag ? 2 : 5) * dt);
      g.vx *= kd;
      g.vy *= kd;
      g.x += g.vx * dt;
      g.y += g.vy * dt;
      if (d2 < 22 * 22) {
        W.xp += g.v * W.stats.xp;
        W.xpGot = (W.xpGot || 0) + g.v;
        collectSound();
        G[i] = G[G.length - 1];
        G.pop();
      }
    }
  }
  function collectSound() {
    const now = W.heard;
    if (now - pickupLastT > 1.0) pickupIdx = 0;
    pickupLastT = now;
    const tq = Seq.gridSound();
    if (W._lastPickSlot === tq) return;
    W._lastPickSlot = tq;
    const I = W.curI;
    if (!I) return;
    const pool = Harmony.pentaNotes(I.key, I.mode, 72, 100);
    Synth.pickup(tq, pool[Math.min(pool.length - 1, pickupIdx)]);
    pickupIdx = (pickupIdx + 1) % pool.length;
  }

  function updatePickups(dt) {
    const p = W.player;
    const P = W.pickups;
    for (let i = P.length - 1; i >= 0; i--) {
      const k = P[i];
      k.age += dt;
      const d2 = U.dist2(p.x, p.y, k.x, k.y);
      if (d2 < W.stats.pickup * W.stats.pickup * 0.6) {
        const d = Math.sqrt(d2) || 1;
        k.x += ((p.x - k.x) / d) * 500 * dt;
        k.y += ((p.y - k.y) / d) * 500 * dt;
      }
      if (d2 < 28 * 28) {
        if (k.kind === 'heal') {
          W.heal(20);
          W.burst(p.x, p.y, U.hex('#5cff9d', 2), 14, 200, 0.4);
          Synth.perfect(AE.Clock.sched() + 0.005, [72, 76, 79]);
        } else if (k.kind === 'magnet') {
          for (const g of W.gems) g.mag = true;
          Synth.swoosh(AE.Clock.sched() + 0.005);
        } else if (k.kind === 'chest') {
          W.pendingChests++;
          if (k.big) W.pendingBig = (W.pendingBig || 0) + 1;
        }
        P.splice(i, 1);
      }
    }
  }

  function updateAura(dt) {
    if (W.auraPulse > 0) W.auraPulse = Math.max(0, W.auraPulse - dt * 2.5);
  }

  // ---------------------------------------------------------------- 粒子
  function mkPart(x, y, vx, vy, size, life, col, shape, rot, grow) {
    return { x, y, vx, vy, size, life, max: life, col, shape, rot, grow: grow || 0, drag: 3 };
  }
  W.burst = function (x, y, col, n, speed, life) {
    if (W.parts.length > 2600) n = Math.ceil(n / 3);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = speed * (0.3 + Math.random() * 0.7);
      W.parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, size: 2 + Math.random() * 3, life: life * (0.6 + Math.random() * 0.6), max: life, col, shape: SH.SEG, rot: a, grow: 0, drag: 4 });
    }
  };
  W.spark = function (x, y, col) {
    if (W.parts.length > 2400) return;
    const a = Math.random() * TAU;
    W.parts.push({ x, y, vx: Math.cos(a) * 160, vy: Math.sin(a) * 160, size: 2, life: 0.18, max: 0.18, col, shape: SH.SEG, rot: a, grow: 0, drag: 5 });
  };
  W.updateParts = function (dt) {
    const P = W.parts;
    for (let i = P.length - 1; i >= 0; i--) {
      const q = P[i];
      q.life -= dt;
      if (q.life <= 0) {
        P[i] = P[P.length - 1];
        P.pop();
        continue;
      }
      const kd = Math.exp(-q.drag * dt);
      q.vx *= kd;
      q.vy *= kd;
      q.x += q.vx * dt;
      q.y += q.vy * dt;
      if (q.grow) q.size += q.grow * dt;
    }
    for (const b of W.bolts) b.age += dt;
    for (let i = W.bolts.length - 1; i >= 0; i--) if (W.bolts[i].age > W.bolts[i].life) W.bolts.splice(i, 1);
    for (const pl of W.pillars) pl.age += dt;
    for (let i = W.pillars.length - 1; i >= 0; i--) if (W.pillars[i].age > 0.45) W.pillars.splice(i, 1);
  };

  return W;
})();
