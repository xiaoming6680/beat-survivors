'use strict';
// 启动、主循环、状态机、输入、自动驾驶（模拟 / 演示）、调试面板。

const Params = new URLSearchParams(location.search);

// ---------------------------------------------------------------- 调试面板
const Debug = (() => {
  const D = {
    on: Params.has('debug'),
    frames: [],
    late: [],
    judges: [],
    el: null,
  };
  function frame(ms) {
    D.frames.push(ms);
    if (D.frames.length > 120) D.frames.shift();
  }
  function late(v) {
    D.late.push(v);
    if (D.late.length > 400) D.late.shift();
  }
  D.works = [];
  function work(ms) {
    D.works.push(ms);
    if (D.works.length > 120) D.works.shift();
  }
  function judge(off) {
    D.judges.push(off);
    if (D.judges.length > 16) D.judges.shift();
  }
  function stats() {
    const f = D.frames;
    if (!f.length) return {};
    const avg = f.reduce((a, b) => a + b, 0) / f.length;
    const worst = Math.max(...f);
    const sorted = f.slice().sort((a, b) => b - a);
    const p99 = sorted[Math.floor(sorted.length * 0.01)] || worst;
    const L = D.late;
    const lateAvg = L.length ? L.reduce((a, b) => a + b, 0) / L.length : 0;
    const lateMax = L.length ? Math.max(...L) : 0;
    const Wk = D.works;
    const workAvg = Wk.length ? Wk.reduce((a, b) => a + b, 0) / Wk.length : 0;
    const workMax = Wk.length ? Math.max(...Wk) : 0;
    return { fps: 1000 / avg, avg, worst, p99, lateAvg, lateMax, workAvg, workMax };
  }
  function draw() {
    if (!D.el) D.el = document.getElementById('debug');
    D.el.classList.toggle('show', D.on);
    if (!D.on) return;
    const s = stats();
    const ctx = AE.A.live && AE.A.live.ctx;
    const J = D.judges;
    const jAvg = J.length ? (J.reduce((a, b) => a + b, 0) / J.length) * 1000 : 0;
    D.el.textContent =
      `FPS ${s.fps ? s.fps.toFixed(0) : '-'}  帧 ${s.avg ? s.avg.toFixed(1) : '-'}ms  最慢 ${s.worst ? s.worst.toFixed(1) : '-'}ms  CPU ${s.workAvg ? s.workAvg.toFixed(1) : '-'}/${s.workMax ? s.workMax.toFixed(1) : '-'}ms\n` +
      `敌人 ${W.enemies.length}  弹 ${W.shots.length + W.homers.length}  粒子 ${W.parts.length}  宝石 ${W.gems.length}  图元 ${Game.lastSprites}\n` +
      (ctx ? `音频 base ${(ctx.baseLatency * 1000).toFixed(1)}ms  out ${((ctx.outputLatency || 0) * 1000).toFixed(1)}ms  调度领先 ${((ctx.currentTime - W.heard) * 1000).toFixed(1)}ms\n` : '音频：虚拟时钟\n') +
      `事件处理滞后 平均 ${(s.lateAvg * 1000).toFixed(1)}ms  最大 ${(s.lateMax * 1000).toFixed(1)}ms\n` +
      `冲刺偏差（近 ${J.length} 次）平均 ${jAvg.toFixed(0)}ms\n` +
      `小节 ${Seq.S.bar}  步 ${Seq.S.songSteps}  段落 ${W.curI ? W.curI.sec.id : '-'}  律动 ${W.groove.toFixed(0)}  Lv ${W.level}\n` +
      `[L]升级 [K]清屏 [N]下一段 [G]律动 [I]无敌 [H]回血 [C]宝箱`;
  }
  return { D, frame, late, judge, stats, draw, work };
})();

// ---------------------------------------------------------------- 自动驾驶
const Bot = (() => {
  let wander = Math.random() * TAU;
  function think() {
    const p = W.player;
    let fx = 0, fy = 0;
    let danger = 0;
    W.forTargets(p.x, p.y, 300, (e) => {
      const dx = p.x - e.x, dy = p.y - e.y;
      const d = Math.hypot(dx, dy) || 1;
      if (e.boss) {
        // 贴着 Boss 打：太近就退，太远就靠；残血时拉开
        const want = e.r + (p.hp < p.maxHp * 0.45 ? 320 : 150);
        const w = d < want ? 4 * (want - d) / want : -1.2 * Math.min(1, (d - want) / 300);
        fx += (dx / d) * w;
        fy += (dy / d) * w;
        if (d < e.r + 30) danger += 2;
        return;
      }
      if (d > 300) return;
      const w = Math.pow(Math.max(0, 300 - d + e.r) / 300, 2) * (e.r > 20 ? 2 : 1);
      fx += (dx / d) * w;
      fy += (dy / d) * w;
      if (d < e.r + 40) danger++;
    });
    for (const b of W.ebullets) {
      const dx = p.x - b.x, dy = p.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      if (d < 160) {
        const w = Math.pow((160 - d) / 160, 2) * 3;
        fx += (dx / d) * w;
        fy += (dy / d) * w;
        if (d < 40) danger += 2;
      }
    }
    for (const h of W.hazards) {
      if (h.kind === 'ring') {
        const d = Math.hypot(p.x - h.x, p.y - h.y);
        const ahead = d - h.r;
        if (ahead > 0 && ahead < 220 && !h.hit) {
          // 往缺口方向绕
          const a = Math.atan2(p.y - h.y, p.x - h.x);
          const da = U.angleDiff(h.gap, a);
          if (Math.abs(da) > h.gapHalf * 0.6) {
            const tx = -Math.sin(a) * Math.sign(da), ty = Math.cos(a) * Math.sign(da);
            fx += tx * 3;
            fy += ty * 3;
          }
          if (ahead < 45 && Math.abs(da) > h.gapHalf) danger += 3;
        }
      } else if (h.kind === 'laser') {
        const nx = -Math.sin(h.ang), ny = Math.cos(h.ang);
        const s = (p.x - h.x) * nx + (p.y - h.y) * ny;
        if (Math.abs(s) < 60) {
          fx += Math.sign(s || 1) * nx * 4;
          fy += Math.sign(s || 1) * ny * 4;
          if (W.heard > h.warnUntil - 0.12) danger += 3;
        }
      }
    }
    // 吸引：宝箱、回血、宝石
    let best = null, bd = 1e12;
    for (const k of W.pickups) {
      const d = U.dist2(p.x, p.y, k.x, k.y);
      if (d < bd) { bd = d; best = k; }
    }
    if (best && bd < 700 * 700) {
      const d = Math.sqrt(bd) || 1;
      fx += ((best.x - p.x) / d) * 1.2;
      fy += ((best.y - p.y) / d) * 1.2;
    } else {
      let g = null, gd = 1e12;
      for (let i = 0; i < W.gems.length; i += 3) {
        const q = W.gems[i];
        const d = U.dist2(p.x, p.y, q.x, q.y);
        if (d < gd) { gd = d; g = q; }
      }
      if (g && gd < 600 * 600) {
        const d = Math.sqrt(gd) || 1;
        const w = danger ? 0.4 : 1.1;
        fx += ((g.x - p.x) / d) * w;
        fy += ((g.y - p.y) / d) * w;
      }
    }
    wander += (Math.random() - 0.5) * 0.3;
    fx += Math.cos(wander) * 0.25;
    fy += Math.sin(wander) * 0.25;
    const l = Math.hypot(fx, fy);
    W.input.x = l > 0.05 ? fx / l : 0;
    W.input.y = l > 0.05 ? fy / l : 0;
    // 冲刺：有危险，或者正好在拍点上（练练踩拍）
    if (p.dashT <= 0 && p.charges > 0) {
      const ph = Seq.beatPhase(W.heard);
      const onBeat = ph < 0.03 || ph > 0.985;
      if ((danger > 0 && (onBeat || p.charges > 1 || danger > 2)) || (onBeat && danger === 0 && Math.random() < 0.08)) {
        // 模拟人手的误差：大约六成能踩准
        const err = (Math.random() + Math.random() + Math.random() - 1.5) * 0.11 * Bot.skill;
        W.tryDash(Bot.perfNow(), err);
      }
    }
  }
  function choose(opts) {
    let best = 0, bs = -1;
    opts.forEach((o, i) => {
      let s = Math.random();
      if (o.kind === 'remix') s += 10;
      else if (o.kind === 'inst' && o.lv === 0) s += 3;
      else if (o.kind === 'inst') s += 2 + (W.inst[o.id] || 0) * 0.2;
      else if (o.kind === 'fx' && o.lv > 0) s += 1.5;
      else if (o.kind === 'fx') s += 1;
      if (s > bs) { bs = s; best = i; }
    });
    return opts[best];
  }
  return { think, choose, skill: parseFloat(Params.get('skill') || '1'), perfNow: () => (AE.Clock.mode === 'virtual' ? 0 : performance.now()) };
})();

// ---------------------------------------------------------------- 游戏
const Game = (() => {
  const G = {
    state: 'boot',
    settings: null,
    debug: Debug.D.on,
    bot: Params.has('bot'),
    sim: Params.has('sim'),
    devUnlock: Params.has('unlock'),
    lastSprites: 0,
    keys: {},
    menuStyle: null,
    replay: null,
    calib: null,
    runStyle: 'house',
    lastFrame: performance.now(),
    lastHeard: 0,
    runResult: null,
  };

  // ---------------- 设置 ----------------
  function applySettings() {
    const s = Meta.D.settings;
    G.settings = s;
    AE.setVolumes({ master: s.master, music: s.music, sfx: s.sfx });
    AE.Clock.calib = (s.latency || 0) / 1000;
    W.reduceFlash = s.flash === 'reduced';
    W.fxAlpha = s.fxAlpha !== undefined ? s.fxAlpha : 0.85;
    if (R.ok && G._quality !== s.quality) {
      G._quality = s.quality;
      R.setQuality(s.quality);
    }
    document.getElementById('fps').classList.toggle('show', !!s.showFps);
  }
  function setAccent(style) {
    const r = document.documentElement.style;
    r.setProperty('--accent', style.color);
    r.setProperty('--accent2', style.tint2);
    // 曲风的画面性格（像素化、扫描线、调色……）
    const p = style.post || {};
    const P = R.post;
    P.pixel = p.pixel || 0;
    P.scan = p.scan || 0;
    P.grade = p.grade || [1, 1, 1];
    P.styleDesat = p.styleDesat || 0;
    P.caBoost = p.caBoost || 0;
    P.grainBoost = p.grainBoost || 0;
    P.vigBoost = p.vigBoost || 0;
  }

  // ---------------- 菜单音乐 ----------------
  function menuMusic(style) {
    if (!AE.on) return;
    if (G.menuStyle === style.id && Seq.S.running && Seq.S.mode === 'menu') return;
    G.menuStyle = style.id;
    AE.resetMix();
    AE.applyFx({});
    W.style = style;
    Seq.start(style, { mode: 'menu', delay: 0.15 });
  }

  // ---------------- 一局 ----------------
  function startRun(styleId) {
    const style = STYLES[styleId];
    if (!Meta.isStyleUnlocked(styleId)) return;
    G.runStyle = styleId;
    Meta.D.lastStyle = styleId;
    Meta.save();
    setAccent(style);
    G.menuStyle = null;
    if (AE.on) AE.resetMix();
    W.reset(style, Meta.runMeta(), { diff: parseFloat(Params.get('diff') || '1') });
    W.reduceFlash = G.settings.flash === 'reduced';
    Seq.start(style, { mode: 'game', arr: W.arrangement(), seed: Math.floor(Math.random() * 1000), startBar: parseInt(Params.get('bar') || '0', 10), delay: 0.25 });
    W.recChanges = [{ s: 0, arr: W.arrangement() }];
    W.resumeT = Seq.S.t0;
    Debug.D.late.length = 0;
    // 调试参数：?god 无敌，?lv=20 开局直接升到 20 级（由自动选卡处理）
    W.god = Params.has('god');
    if (Params.get('lv')) {
      W.pendingLevels = Math.max(0, parseInt(Params.get('lv'), 10) - 1);
      W.level = W.pendingLevels + 1;
      W.xpNext = 10 + 6 * W.level + Math.round(0.55 * W.level * W.level);
    }
    G.lastHeard = AE.Clock.now();
    R.cam.x = 0;
    R.cam.y = 0;
    UI.buildTimeline();
    UI.show(true);
    Screens.hideAll();
    blurFocus();
    G.state = 'play';
    if (!Meta.D.seenTutorial) {
      setTimeout(() => UI.hint('<b>WASD / 方向键</b> 移动 · 武器会跟着节拍自动攻击', 6), 600);
      setTimeout(() => UI.hint('<b>空格</b> 冲刺 · 在<b>拍点上</b>按 = 完美冲刺：不耗充能、放冲击波', 7), 8000);
      Meta.D.seenTutorial = true;
      Meta.save();
    } else {
      setTimeout(() => UI.hint(`${style.char} · ${style.genre} · ${style.bpm} BPM`, 3), 400);
    }
  }

  function enterLevel(title) {
    G.state = 'levelup';
    W.frozen = true;
    W.input.x = W.input.y = 0;
    Seq.hold();
    AE.setHold(true);
    Synth.rewind(AE.Clock.sched() + 0.01);
    const n = W.grooveTier >= 2 ? 4 : 3;
    const opts = Upgrades.roll(n);
    if (G.bot || G.sim) {
      pickOption(Bot.choose(opts));
      return;
    }
    Screens.showLevel(opts, pickOption, title);
  }
  function pickOption(o) {
    Upgrades.apply(o);
    W.pendingLevels = Math.max(0, W.pendingLevels - 1);
    Seq.S.preview = null;
    AE.applyFx(W.fx);
    if (W.pendingLevels > 0) {
      const opts = Upgrades.roll(W.grooveTier >= 2 ? 4 : 3);
      if (G.bot || G.sim) return pickOption(Bot.choose(opts));
      Screens.showLevel(opts, pickOption);
      return;
    }
    resumeFromHold();
  }
  function previewOption(o) {
    if (G.state !== 'levelup') return;
    const a = W.arrangement(o);
    Seq.S.preview = a;
    AE.applyFx(a.fx);
  }
  function reroll() {
    if (W.rerolls <= 0) { Synth.ui('deny'); return; }
    W.rerolls--;
    Screens.showLevel(Upgrades.roll(W.grooveTier >= 2 ? 4 : 3), pickOption);
  }
  function banish(o) {
    if (W.banishes <= 0 || !o || (o.kind !== 'inst' && o.kind !== 'fx') || o.lv > 0) { Synth.ui('deny'); return; }
    W.banishes--;
    W.banished[o.id] = true;
    Screens.showLevel(Upgrades.roll(W.grooveTier >= 2 ? 4 : 3), pickOption);
  }
  function resumeFromHold() {
    Screens.hideAll();
    blurFocus();
    const t = Seq.release();
    W.resumeT = t;
    W.frozen = false;
    AE.setHold(false);
    AE.applyFx(W.fx);
    Synth.swoosh(Math.max(AE.Clock.sched() + 0.01, t - 0.42));
    G.state = 'play';
  }

  function openChest() {
    G.state = 'chest';
    W.pendingChests--;
    W.frozen = true;
    W.input.x = W.input.y = 0;
    Seq.hold();
    AE.setHold(true);
    const big = W.pendingBig > 0;
    if (big) W.pendingBig--;
    const items = Upgrades.chest(big);
    items.forEach((o) => Upgrades.apply(o));
    if (items.some((o) => o.kind === 'remix')) W.remixCount = (W.remixCount || 0) + 1;
    if (G.bot || G.sim) return resumeFromHold();
    Screens.showChest(items, () => resumeFromHold());
  }

  function pause() {
    if (G.state !== 'play') return;
    G.state = 'paused';
    AE.suspend();
    Screens.showPause();
  }
  function resume() {
    if (G.state !== 'paused') return;
    Screens.hideAll();
    blurFocus();
    AE.resume().then(() => {
      G.state = 'play';
      G.lastHeard = AE.Clock.now();
    });
  }
  function quit() {
    if (G.state === 'paused') AE.resume();
    G.state = 'dead';
    W.over = true;
    Seq.stop();
    finish(false);
  }

  function onDeath() {
    if (G.state === 'dead') return;
    G.state = 'dead';
    Seq.stop();
    AE.powerDown();
    W.flash(0.4, [1, 0.2, 0.3]);
    UI.banner('演出中断', 'CUT');
    if (G.sim) return finish(false);
    setTimeout(() => finish(false), 2600);
  }
  function onVictory() {
    if (G.state === 'won') return;
    G.state = 'won';
    W.over = true;
    W.victory = true;
    Seq.stop();
    UI.banner('演出完成', 'ENCORE', true);
    if (G.sim) return finish(true);
    setTimeout(() => finish(true), 2400);
  }

  // ---------------- 结算 ----------------
  const NOUN = { kick: '心跳', snare: '碎裂', hat: '星屑', bass: '深潜', pad: '薄雾', arp: '星轨', stab: '霓虹', bell: '冰晶', toms: '雷鸣', lead: '独白' };
  const ADJ = { overdrive: '灼热', reverb: '空旷', delay: '回声', chorus: '重影', compressor: '紧绷', sidechain: '呼吸', metronome: '精准', lfo: '漂流', exciter: '闪耀', mastering: '饱满' };
  const STYLE_ADJ = { house: '午夜', chip: '像素', synthwave: '夜驰', dnb: '疾走', lofi: '午后' };
  function songName() {
    const top = (obj, order) => {
      let best = null, bl = -1;
      for (const id of order) if ((obj[id] || 0) > bl) { bl = obj[id] || 0; best = id; }
      return bl > 0 ? best : null;
    };
    const i = top(W.inst, INST_ORDER) || W.style.start;
    const f = top(W.fx, FX_ORDER);
    return (f ? ADJ[f] : STYLE_ADJ[W.style.id]) + NOUN[i];
  }
  function arrangementData() {
    const log = Seq.S.barLog;
    const played = Math.max(1, Math.ceil(Seq.S.songSteps / 16));
    // 按实际播放顺序拼段落
    const sections = [];
    for (let i = 0; i < Math.min(log.length, played); i++) {
      const sec = Song.sectionAt(log[i]);
      const last = sections[sections.length - 1];
      if (last && last.idx === sec.idx && last.start + last.bars === i) last.bars++;
      else sections.push({ idx: sec.idx, type: sec.type, start: i, bars: 1 });
    }
    const lanes = [];
    for (const id of INST_ORDER) {
      const ev = W.log.filter((l) => l.id === id && l.kind === 'inst');
      if (!ev.length) continue;
      const rm = W.log.find((l) => l.id === id && l.kind === 'remix');
      lanes.push({ id, name: INST[id].name, color: INST[id].color, max: 6, levels: ev.map((l) => ({ bar: l.s / 16, lv: l.lv })), remixBar: rm ? rm.s / 16 : undefined });
    }
    for (const id of FX_ORDER) {
      const ev = W.log.filter((l) => l.id === id && l.kind === 'fx');
      if (!ev.length) continue;
      lanes.push({ id, name: FX[id].name, color: FX[id].color, max: 5, levels: ev.map((l) => ({ bar: l.s / 16, lv: l.lv })) });
    }
    return { sections, totalBars: played, endBar: played, lanes };
  }
  function finish(clear) {
    const time = Seq.S.songSteps * Seq.stepDur();
    const score = Math.max(0, Math.round(W.kills + 800 * W.bossKills.length + 25 * W.perfects + time * 3 + (clear ? 4000 : 0) - W.dmgTaken * 2));
    const grade = clear && score >= 13000 ? 'S' : score >= 9500 ? 'A' : score >= 6500 ? 'B' : score >= 3500 ? 'C' : 'D';
    const name = songName();
    const r = {
      style: W.style.id, clear, time, kills: W.kills, level: W.level, perfects: W.perfects, maxCombo: W.maxCombo,
      maxGroove: W.maxGrooveTier, dmgTaken: W.dmgTaken, bossKills: W.bossKills.slice(), instCount: Object.keys(W.inst).length,
      remixes: Object.keys(W.remix).length, bonusNotes: W.bonusNotes || 0, score, grade, name, arr: arrangementData(),
    };
    r.record = { id: Date.now(), name, style: r.style, date: Date.now(), time, kills: r.kills, grade, clear, bars: Seq.S.barLog.slice(0, Math.ceil(Seq.S.songSteps / 16) + 1), changes: W.recChanges, arr: r.arr };
    G.runResult = r;
    if (G.sim) {
      Sim.done(r);
      return;
    }
    const gain = Meta.finishRun(r);
    UI.show(false);
    G.state = 'results';
    Screens.showResults(r, gain);
    setTimeout(() => menuMusic(W.style), 300);
  }

  // ---------------- 唱片重放 ----------------
  function playRecord(rec) {
    if (!AE.on) return;
    const style = STYLES[rec.style];
    AE.resetMix();
    G.menuStyle = null;
    G.replay = rec;
    W.style = style;
    setAccent(style);
    Seq.start(style, { mode: 'game', rec: { bars: rec.bars, changes: rec.changes }, arr: rec.changes[0].arr, startBar: rec.bars[0], delay: 0.2 });
    AE.applyFx(rec.changes[0].arr.fx);
    document.getElementById('rec-player').classList.add('show');
    document.querySelectorAll('.rec').forEach((el) => el.classList.toggle('playing', +el.dataset.id === rec.id));
  }
  // 导出 WAV：离线渲染整张唱片（期间菜单音乐暂停）
  async function exportRecord(rec, btn) {
    if (G.exporting) return;
    G.exporting = true;
    stopRecord();
    Seq.stop();
    G.menuStyle = null;
    const label = btn ? btn.textContent : '';
    const setLabel = (s) => { if (btn) btn.textContent = s; };
    setLabel('渲染中 0%');
    try {
      const buf = await Offline.render({ style: STYLES[rec.style], rec, sampleRate: 44100, tail: 3, onProgress: (f) => setLabel(`渲染中 ${Math.round(f * 100)}%`) });
      const blob = Offline.toWav(buf);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `节拍幸存者-${rec.name}.wav`;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      setLabel('已导出');
    } catch (err) {
      console.error(err);
      setLabel('导出失败');
    }
    setTimeout(() => setLabel(label), 2500);
    G.exporting = false;
    menuMusic(STYLES[Meta.D.lastStyle] || STYLES.house);
  }
  function stopRecord() {
    if (!G.replay) return;
    G.replay = null;
    document.getElementById('rec-player').classList.remove('show');
    document.querySelectorAll('.rec').forEach((el) => el.classList.remove('playing'));
    menuMusic(STYLES[Meta.D.lastStyle] || STYLES.house);
  }

  // ---------------- 主循环 ----------------
  const evBuf = [];
  function frame(now) {
    requestAnimationFrame(frame);
    G.lastRaf = performance.now();
    runFrame(now);
  }
  function runFrame(now) {
    if (G.sim) return;
    const dtReal = Math.min(0.1, (now - G.lastFrame) / 1000);
    G.lastFrame = now;
    Debug.frame(dtReal * 1000);
    const t0 = performance.now();
    tick(dtReal);
    Debug.work(performance.now() - t0);
  }

  function tick(dtReal) {
    padMenu();
    Seq.tick();
    const heard = AE.Clock.now();
    W.heard = heard;
    const inRun = G.state === 'play' || G.state === 'levelup' || G.state === 'chest' || G.state === 'dead' || G.state === 'won' || G.state === 'paused';
    if (inRun) {
      if (G.bot && G.state === 'play') Bot.think();
      else if (G.state === 'play') readInput();
      W.processEvents();
      let dt = heard - G.lastHeard;
      G.lastHeard = heard;
      const simOn = (G.state === 'play' || G.state === 'dead' || G.state === 'won') && heard >= W.resumeT && !W.frozen;
      if (!simOn || dt < 0) dt = 0;
      dt = Math.min(dt, 0.05);
      if (G.state === 'dead' || G.state === 'won') dt *= 0.35;
      // 受击顿帧：画面停一下，让人意识到“被打了”
      if (W.hitStop > 0) {
        W.hitStop -= dtReal;
        dt = 0;
      }
      if (dt > 0) {
        const n = Math.ceil(dt / (1 / 120));
        for (let i = 0; i < n; i++) W.step(dt / n);
        W.updateParts(dt);
      }
      if (G.state === 'play' && !W.over) {
        if (W.pendingChests > 0) openChest();
        else if (W.pendingLevels > 0) enterLevel();
      }
      Scene.camera(dtReal);
      if (!G.sim || Sim.S.render) {
        Scene.draw();
        G.lastSprites = R.count;
        R.render(dtReal, W.player.x, W.player.y);
        UI.update(dtReal);
      }
    } else {
      menuTick(dtReal, heard);
    }
    if (G.settings && G.settings.showFps) {
      const s = Debug.stats();
      document.getElementById('fps').textContent = s.fps ? `${s.fps.toFixed(0)} FPS` : '';
    }
    Debug.draw();
  }

  // 菜单背景：跟着菜单音乐跳的网格和环形频谱
  const menuDeco = [];
  function menuTick(dt, heard) {
    Seq.popDue(heard, evBuf);
    for (const ev of evBuf) {
      if (ev.type === 'step') {
        W.curI = ev.I;
        if (ev.pos % 4 === 0 && (Seq.S.mode !== 'menu' || ev.bar % 8 >= 2)) {
          W.kick = 1;
          W.lastKickT = ev.t;
          R.addRipple(R.cam.x, R.cam.y, 0.25, 1.1);
        }
      } else if (ev.type === 'inst' && ev.id === 'kick') {
        W.kick = 1;
        W.lastKickT = ev.t;
      } else if (ev.type === 'end' && G.replay) {
        setTimeout(stopRecord, 1500);
      }
    }
    W.heard = heard;
    W.time += dt;
    R.cam.x += dt * 30;
    R.cam.y += dt * 12;
    const P = R.post;
    W.kick *= Math.exp(-7 * dt);
    P.kick = W.kick;
    P.beat = U.clamp((heard - (W.lastKickT || -9)) / 0.75, 0, 1);
    P.ca = 0.0015 + 0.003 * W.kick;
    P.time += dt;
    P.flash *= Math.exp(-4 * dt);
    P.desat = 0;
    P.exposure = 1;
    P.hurt = 0;
    const st = W.style || STYLES.house;
    P.tint = U.hex(st.grid, 1);
    P.tint2 = U.hex(st.tint2, 1);
    P.gridGlow = 0.9;
    R.cam.zoom = 1 + 0.012 * W.kick;
    R.cam.sx = R.cam.sy = 0;
    // 漂浮的霓虹几何
    if (menuDeco.length < 26) {
      menuDeco.push({ a: Math.random() * TAU, r: 260 + Math.random() * 520, s: 6 + Math.random() * 14, sh: [SH.TRI, SH.RHOMB, SH.HEX, SH.BOX, SH.CIRCLE][Math.floor(Math.random() * 5)], sp: (Math.random() - 0.5) * 0.25, h: Math.random() });
    }
    const cx = R.cam.x, cy = R.cam.y;
    for (const d of menuDeco) {
      d.a += d.sp * dt;
      const x = cx + Math.cos(d.a) * d.r * 1.5, y = cy + Math.sin(d.a) * d.r * 0.75;
      R.shape(x, y, d.s * (1 + 0.25 * W.kick), d.a * 3, d.sh, U.hsl(d.h, 0.85, 0.6, 1.3), 0.7, 0.2, 1.8);
    }
    const spec = AE.spectrum();
    const title = Screens.current === 'scr-menu' || Screens.current === 'scr-boot';
    G.specA = U.damp(G.specA || 0, title ? 0.5 : 0.12, 4, dt);
    if (spec) {
      const n = 72;
      for (let i = 0; i < n; i++) {
        const v = spec[Math.floor(2 + Math.pow(i / n, 1.5) * 110)] / 255;
        const a = (i / n) * TAU - Math.PI / 2;
        const r0 = 420, r1 = 420 + v * 90;
        R.line(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0, cx + Math.cos(a) * r1, cy + Math.sin(a) * r1, 2, U.hsl(i / n * 0.7 + 0.5, 0.9, 0.6, 1.2), G.specA);
      }
    }
    R.render(dt, cx, cy);
    document.documentElement.style.setProperty('--pulse', (1 + 0.025 * W.kick).toFixed(4));
    if (G.replay) {
      const S = Seq.S;
      const playhead = (S.recIdx || 0) + S.pos / 16;
      if (!G._recT || W.time - G._recT > 0.05) {
        G._recT = W.time;
        Screens.drawArrangement(document.getElementById('rec-canvas'), G.replay.arr, playhead);
        const I = W.curI;
        document.getElementById('rec-now').textContent = I ? `${SECTION_TYPES[I.type].name} · ${Harmony.chordName(I.chord)} · ${U.fmtTime(S.songSteps * Seq.stepDur())} / ${U.fmtTime(G.replay.time)}` : '';
      }
    }
  }

  // ---------------- 输入 ----------------
  function readInput() {
    const k = G.keys;
    let x = 0, y = 0;
    if (k.KeyA || k.ArrowLeft) x -= 1;
    if (k.KeyD || k.ArrowRight) x += 1;
    if (k.KeyW || k.ArrowUp) y -= 1;
    if (k.KeyS || k.ArrowDown) y += 1;
    // 手柄
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] || 0, ay = gp.axes[1] || 0;
      if (Math.hypot(ax, ay) > 0.25) { x = ax; y = ay; }
      if (gp.buttons[14] && gp.buttons[14].pressed) x = -1;
      if (gp.buttons[15] && gp.buttons[15].pressed) x = 1;
      if (gp.buttons[12] && gp.buttons[12].pressed) y = -1;
      if (gp.buttons[13] && gp.buttons[13].pressed) y = 1;
      const dashBtn = (gp.buttons[0] && gp.buttons[0].pressed) || (gp.buttons[5] && gp.buttons[5].pressed);
      if (dashBtn && !G._padDash) W.tryDash(performance.now());
      G._padDash = dashBtn;
      const start = gp.buttons[9] && gp.buttons[9].pressed;
      if (start && !G._padStart) pause();
      G._padStart = start;
    }
    W.input.x = x;
    W.input.y = y;
  }

  function onKeyDown(e) {
    if (e.repeat && (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight')) return;
    G.keys[e.code] = true;
    if (G.state === 'boot') { unlock(); e.preventDefault(); return; }
    if (G.calib) { calibTap(e); e.preventDefault(); return; }
    if (G.state === 'play') {
      if (e.code === 'Space' || e.code === 'ShiftLeft' || e.code === 'ShiftRight' || e.code === 'KeyJ') {
        W.tryDash(e.timeStamp);
        e.preventDefault();
      } else if (e.code === 'Escape' || e.code === 'KeyP') pause();
      else if (G.debug) debugKey(e.code);
      return;
    }
    if (G.state === 'levelup') {
      if (Screens.levelKey(e)) e.preventDefault();
      return;
    }
    if (G.state === 'chest') {
      if (Screens.chestKey(e)) e.preventDefault();
      return;
    }
    if (G.state === 'paused' && (e.code === 'Escape' || e.code === 'KeyP') && Screens.current === 'scr-pause') { resume(); return; }
    // 菜单导航
    if (e.code === 'ArrowDown' || e.code === 'ArrowRight' || e.code === 'KeyS' || e.code === 'KeyD') { Screens.moveFocus(1); e.preventDefault(); }
    else if (e.code === 'ArrowUp' || e.code === 'ArrowLeft' || e.code === 'KeyW' || e.code === 'KeyA') { Screens.moveFocus(-1); e.preventDefault(); }
    else if (e.code === 'Enter' || e.code === 'Space') {
      const a = document.activeElement;
      if (a && a.classList.contains('char')) { e.preventDefault(); startRun(a.dataset.id); }
    } else if (e.code === 'Escape') back();
  }
  function onKeyUp(e) {
    G.keys[e.code] = false;
    // 游戏中 / 选卡 / 宝箱 / 校准时，松开空格或回车不能去“点”某个还带着焦点的按钮
    if ((G.calib || G.state === 'play' || G.state === 'levelup' || G.state === 'chest') && (e.code === 'Space' || e.code === 'Enter')) e.preventDefault();
  }

  // 手柄在升级 / 宝箱界面：左右选择、A 确认（只认“新按下”）
  const padPrev = { left: false, right: false, a: false };
  function padMenu() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let left = false, right = false, a = false;
    for (const gp of pads) {
      if (!gp) continue;
      const ax = gp.axes[0] || 0;
      const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
      left = left || ax < -0.5 || b(14);
      right = right || ax > 0.5 || b(15);
      a = a || b(0);
    }
    if (G.state === 'levelup') {
      if (left && !padPrev.left) Screens.levelPad('left');
      if (right && !padPrev.right) Screens.levelPad('right');
      if (a && !padPrev.a) Screens.levelPad('confirm');
    } else if (G.state === 'chest' && a && !padPrev.a) Screens.chestContinue();
    padPrev.left = left;
    padPrev.right = right;
    padPrev.a = a;
  }
  function blurFocus() {
    if (document.activeElement && document.activeElement !== document.body && document.activeElement.blur) document.activeElement.blur();
  }

  function debugKey(code) {
    if (code === 'KeyL') W.pendingLevels++;
    else if (code === 'KeyK') {
      for (const e of W.enemies.slice()) if (!e.boss) W.kill(e);
    } else if (code === 'KeyG') W.groove = Math.min(100, W.groove + 30);
    else if (code === 'KeyI') W.player.invuln = W.player.invuln > 100 ? 0 : 1e9;
    else if (code === 'KeyH') W.heal(999);
    else if (code === 'KeyC') W.pendingChests++;
    else if (code === 'KeyN') {
      const sec = Song.sectionAt(Seq.S.bar);
      const next = Song.S.sections[sec.idx + 1];
      if (next) Seq.S.bar = next.start - 1;
    }
  }

  // ---------------- 校准 ----------------
  // 播放一串木鱼嘀嗒（落在音序器的拍子网格上），玩家跟着按空格；去掉前 2 下，取中位数
  const CALIB_TAPS = 10;
  function startCalib(btn) {
    const out = document.getElementById('calib-out');
    blurFocus();
    if (G.state === 'paused' || !AE.on || AE.A.live.ctx.state !== 'running') {
      out.textContent = '暂停中没法校准，请回主菜单的设置里校准';
      return;
    }
    if (G.calib) return;
    const bd = Seq.beatDur();
    const first = Seq.nearestBeat(AE.Clock.sched() + 0.6).t;
    const clicks = [];
    for (let k = 0; k < CALIB_TAPS + 6; k++) {
      const t = first + k * bd;
      clicks.push(t);
      Synth.woodblock(t, 1.2, k % 4 === 0);
    }
    G.calib = { offs: [], clicks, btn: btn || null };
    if (btn) { btn.disabled = true; btn.textContent = '校准中…'; }
    out.textContent = `听木鱼声，每一下按一次空格（0 / ${CALIB_TAPS}）· Esc 取消`;
    G.calib.timer = setTimeout(() => endCalib('超时了，再试一次'), (CALIB_TAPS + 8) * bd * 1000 + 600);
  }
  function endCalib(msg) {
    if (!G.calib) return;
    clearTimeout(G.calib.timer);
    if (G.calib.btn) { G.calib.btn.disabled = false; G.calib.btn.textContent = '开始校准'; }
    G.calib = null;
    if (msg) document.getElementById('calib-out').textContent = msg;
  }
  function calibTap(e) {
    if (e.code === 'Escape') { endCalib('已取消'); return; }
    if (e.code !== 'Space' || e.repeat) return;
    const C = G.calib;
    // 用“不含当前补偿”的听感时间，和嘀嗒声的实际时间比
    const h = AE.Clock.fromPerf(e.timeStamp) + AE.Clock.calib;
    let best = C.clicks[0];
    for (const t of C.clicks) if (Math.abs(t - h) < Math.abs(best - h)) best = t;
    C.offs.push(h - best);
    const n = C.offs.length;
    document.getElementById('calib-out').textContent = `听木鱼声，每一下按一次空格（${n} / ${CALIB_TAPS}）· Esc 取消`;
    if (n >= CALIB_TAPS) {
      const o = C.offs.slice(2).sort((a, b) => a - b);
      const med = o.length % 2 ? o[(o.length - 1) / 2] : (o[o.length / 2 - 1] + o[o.length / 2]) / 2;
      const ms = Math.round(U.clamp(med * 1000, -150, 250) / 5) * 5;
      Meta.D.settings.latency = ms;
      Meta.save();
      applySettings();
      endCalib();
      Screens.buildSettings();
      document.getElementById('calib-out').textContent = `完成：延迟补偿设为 ${ms}ms`;
    }
  }

  // ---------------- 界面切换 ----------------
  function back() {
    if (G.state === 'paused' && Screens.current === 'scr-settings') { Screens.showPause(); return; }
    if (Screens.current === 'scr-records') stopRecord();
    if (Screens.current === 'scr-menu') return;
    Screens.refreshMenu();
    Screens.show('scr-menu');
  }

  function bindUI() {
    Screens.bindActs('scr-menu', {
      play: () => { Screens.buildChars(); Screens.show('scr-chars'); },
      shop: () => { Screens.buildShop(); Screens.show('scr-shop'); },
      records: () => { Screens.buildRecords(); Screens.show('scr-records'); },
      ach: () => { Screens.buildAch(); Screens.show('scr-ach'); },
      settings: () => { Screens.buildSettings(); Screens.show('scr-settings'); },
      help: () => Screens.show('scr-help'),
    });
    Screens.bindActs('scr-chars', { back, go: () => startRun(Screens.selStyle) });
    Screens.bindActs('scr-pause', {
      resume,
      settings: () => { Screens.buildSettings(); Screens.show('scr-settings'); },
      quit,
    });
    Screens.bindActs('scr-results', {
      again: () => startRun(G.runStyle),
      chars: () => { Screens.buildChars(); Screens.show('scr-chars'); },
      menu: () => { Screens.refreshMenu(); Screens.show('scr-menu'); },
    });
    Screens.bindActs('scr-shop', { back, refund: () => { Meta.refundShop(); Screens.buildShop(); } });
    Screens.bindActs('scr-records', { back, stoprec: stopRecord });
    Screens.bindActs('scr-ach', { back });
    Screens.bindActs('scr-settings', { back: () => { endCalib(''); back(); }, calib: (b) => startCalib(b) });
    document.getElementById('scr-chest').addEventListener('click', () => { if (G.state === 'chest') Screens.chestContinue(); });
    Screens.bindActs('scr-help', { back });
  }

  // ---------------- 启动 ----------------
  function unlock() {
    if (G.state !== 'boot') return;
    if (!AE.init()) {
      document.getElementById('boot-err').textContent = '这个浏览器不支持 Web Audio。请用最新版 Edge 或 Chrome。';
      return;
    }
    G.state = 'menu';
    AE.resume().then(() => {
      applySettings();
      const st = STYLES[Meta.D.lastStyle] && Meta.isStyleUnlocked(Meta.D.lastStyle) ? STYLES[Meta.D.lastStyle] : STYLES.house;
      setAccent(st);
      menuMusic(st);
      if (Params.has('play')) startRun(Params.get('play') || 'house');
      else {
        Screens.refreshMenu();
        Screens.show('scr-menu');
      }
    });
  }

  function boot() {
    Meta.load();
    G.settings = Meta.D.settings;
    const canvas = document.getElementById('gl');
    let ok = false;
    try { ok = R.init(canvas); } catch (err) { console.error(err); document.getElementById('boot-err').textContent = '图形初始化失败：' + err.message; }
    if (!ok && !G.sim) {
      document.getElementById('boot-err').textContent = document.getElementById('boot-err').textContent || '这个浏览器不支持 WebGL2。请用最新版 Edge 或 Chrome，并开启硬件加速。';
    }
    G._quality = 'high';
    if (G.settings.quality !== 'high') R.setQuality(G.settings.quality);
    G._quality = G.settings.quality;
    UI.init();
    bindUI();
    W.reset(STYLES.house, {});
    W.player.alive = true;
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('resize', () => R.resize());
    window.addEventListener('blur', () => { G.keys = {}; if (!G.bot) pause(); });
    document.addEventListener('visibilitychange', () => {
      if (G.bot || G.sim || G.state === 'boot') return;
      if (document.hidden) {
        // 游戏中：正式暂停；菜单 / 升级 / 结算：只挂起音频（后台定时器被节流，音乐会卡）
        if (G.state === 'play') pause();
        else if (AE.on && G.state !== 'paused') { AE.suspend(); G._hiddenSuspended = true; }
      } else if (G._hiddenSuspended) {
        G._hiddenSuspended = false;
        AE.resume();
      }
    });
    document.getElementById('scr-boot').addEventListener('pointerdown', unlock);
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    setAccent(STYLES.house);
    if (G.sim) {
      Sim.start();
      return;
    }
    // 定时器：保证调度不断（rAF 可能被挂起）；rAF 停摆超过 200ms 时由定时器兜底驱动画面
    G.lastRaf = performance.now();
    setInterval(() => {
      if (G.state !== 'boot') Seq.tick();
      const now = performance.now();
      if (now - G.lastRaf > 200 && now - G.lastFrame >= 15) runFrame(now);
    }, 16);
    requestAnimationFrame(frame);
  }

  Object.assign(G, {
    boot, startRun, onDeath, onVictory, previewOption, reroll, banish, setAccent, menuMusic, applySettings, playRecord, stopRecord, exportRecord, tick,
  });
  return G;
})();

// ---------------------------------------------------------------- 模拟模式（无声虚拟时钟 + 自动驾驶，用来调平衡）
const Sim = (() => {
  const S = { results: [], runs: 1, speed: 20, render: false, t0: 0, log: [] };
  function start() {
    AE.useVirtual();
    S.runs = parseInt(Params.get('runs') || '1', 10);
    S.speed = parseFloat(Params.get('speed') || '30');
    S.render = Params.has('render');
    Game.settings = Meta.D.settings;
    Game.bot = true;
    run();
  }
  function run() {
    if (!S.queue) S.queue = (Params.get('batch') || Params.get('style') || 'house').split(',');
    const style = S.queue.shift();
    Game.devUnlock = true;
    S.finished = false;
    S._bossT = null;
    Game.startRun(style);
    S.t0 = performance.now();
    S.log = [];
    S.lastMin = -1;
    loop();
  }
  function loop() {
    const budget = performance.now() + 14;
    let frames = 0;
    while (performance.now() < budget && frames < S.speed && Game.state !== 'results' && !S.finished) {
      AE.Clock.vt += 1 / 60;
      Game.tick(1 / 60);
      frames++;
      const m = Math.floor(W.minutes());
      if (m !== S.lastMin) {
        S.lastMin = m;
        S.log.push({ min: m, lv: W.level, hp: Math.round(W.player.hp), kills: W.kills, enemies: W.enemies.length, xp: `${W.xpGot | 0}/${W.xpDropped | 0}`, inst: Object.assign({}, W.inst), fx: Object.assign({}, W.fx) });
      }
      if (W.enemies.some((e) => e.boss) && !S._bossT) { const b = W.enemies.find((e) => e.boss); S._bossT = { type: b.type, t: W.minutes(), ref: b }; }
      if (S._bossT && !W.enemies.some((e) => e.boss)) {
        S.log.push({ boss: S._bossT.type, spawn: S._bossT.t.toFixed(2), gone: W.minutes().toFixed(2), killed: W.bossKills.includes(S._bossT.type), hpLeft: Math.round((100 * Math.max(0, S._bossT.ref.hp)) / S._bossT.ref.maxHp) + '%' });
        S._bossT = null;
      }
      if (W.minutes() > 14 && !S.finished) { Game.onVictory(); }
    }
    if (!S.finished) setTimeout(loop, 0);
  }
  function done(r) {
    S.finished = true;
    const out = {
      style: r.style, clear: r.clear, time: U.fmtTime(r.time), level: r.level, kills: r.kills, bossKills: r.bossKills,
      perfects: r.perfects, dmgTaken: Math.round(r.dmgTaken), peakEnemies: W.peakEnemies, score: r.score, grade: r.grade,
      wall: ((performance.now() - S.t0) / 1000).toFixed(1) + 's', log: S.log, dmgBy: Object.assign({}, W.dmgBy), lastHurts: W.hurtLog.slice(),
      inst: Object.assign({}, W.inst), fx: Object.assign({}, W.fx),
    };
    window.__simAll = window.__simAll || [];
    window.__simAll.push(out);
    console.log('SIM', JSON.stringify(out));
    const el = document.getElementById('debug');
    el.classList.add('show');
    el.textContent = window.__simAll.map((o) => `${o.style} ${o.clear ? '通关' : '阵亡'} ${o.time} Lv${o.level} 击杀${o.kills} 伤${o.dmgTaken} Boss${o.bossKills.length}`).join('\n');
    if (S.queue.length) setTimeout(run, 50);
    else window.__sim = out;
  }
  return { start, done, S };
})();

window.addEventListener('DOMContentLoaded', () => Game.boot());
