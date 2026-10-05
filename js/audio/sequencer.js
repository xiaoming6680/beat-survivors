'use strict';
// 音序器：整首歌的“指挥”。向前看调度——在精确的音频时间上发声，同时把攻击事件推入队列，
// 游戏在“听到的那一刻”处理事件。维护两个计数：
//   pos（小节内 16 分位置，一直走）和 bar（曲式位置，hold 时冻结 —— 循环当前小节）。

const Seq = (() => {
  const S = {
    running: false,
    mode: 'game',
    style: STYLES.house,
    bpm: 128,
    t0: 0,           // 第 0 步的时间（网格锚点）
    nextT: 0,        // 下一个待调度步的时间（未加摇摆）
    bar: 0,
    pos: 0,
    musicStep: 0,
    songSteps: 0,    // 非 hold 状态下走过的步数（唱片时间线用）
    holding: false,
    resumeT: 0,
    preview: null,   // hold 时试听用的编曲
    arr: { inst: {}, fx: {}, remix: {}, groove: 0 },
    events: [],
    evHead: 0,
    flags: {},
    ended: false,
    arpCount: 0,
    stabCount: 0,
    padVoice: null,
    seed: 0,
    barLog: [],
    lookahead: 0.15,
    rec: null,       // 回放：{ bars: [...], changes: [...] }
  };

  function stepDur() { return 60 / S.bpm / 4; }
  function beatDur() { return 60 / S.bpm; }
  function barDur() { return 240 / S.bpm; }

  function start(style, opts = {}) {
    S.style = style;
    S.bpm = style.bpm;
    S.mode = opts.mode || 'game';
    Song.build(style, { menu: S.mode === 'menu' });
    AE.setStyle(style);
    S.t0 = AE.Clock.sched() + (opts.delay || 0.12);
    S.nextT = S.t0;
    S.bar = opts.startBar || 0;
    S.pos = 0;
    S.musicStep = 0;
    S.songSteps = 0;
    S.holding = false;
    S.preview = null;
    S.resumeT = 0;
    S.events.length = 0;
    S.evHead = 0;
    S.flags = {};
    S.ended = false;
    S.arpCount = 0;
    S.stabCount = 0;
    S.padVoice = null;
    S.seed = opts.seed || 0;
    S.barLog = [S.bar];
    S.rec = opts.rec || null;
    S.recIdx = 0;
    S.recIdx2 = 0;
    if (opts.arr) S.arr = opts.arr;
    S.noBacking = !!opts.noBacking;
    S.running = true;
    tick();
  }
  function stop() {
    S.running = false;
  }

  function hold() {
    S.holding = true;
  }
  function release() {
    S.holding = false;
    S.preview = null;
    S.resumeT = S.nextT;
    return S.resumeT;
  }

  // 下一个可调度的 16 分网格时间
  function nextGrid(minT) {
    const sd = stepDur();
    const k = Math.ceil((minT - S.t0) / sd - 1e-6);
    return S.t0 + Math.max(0, k) * sd;
  }
  function gridSound(extra = 0.012) {
    return nextGrid(AE.Clock.sched() + extra);
  }
  // 32 分网格（钟琴弹跳用）
  function nextGrid32(minT) {
    const sd = stepDur() / 2;
    const k = Math.ceil((minT - S.t0) / sd - 1e-6);
    return S.t0 + Math.max(0, k) * sd;
  }
  // 离 t 最近的拍点
  function nearestBeat(t) {
    const bd = beatDur();
    const k = Math.round((t - S.t0) / bd);
    return { t: S.t0 + k * bd, k };
  }
  function beatPhase(t) {
    const bd = beatDur();
    const x = (t - S.t0) / bd;
    return x - Math.floor(x);
  }

  // ---------- 调度 ----------
  function tick() {
    if (!S.running || S.ended) return;
    const now = AE.Clock.sched();
    // 掉队太多（主线程卡住、标签页被节流）：静默跳过，不补发一串过期的音
    if (AE.on && S.nextT < now - 0.25) {
      let k = Math.ceil((now - S.nextT) / stepDur());
      while (k-- > 0 && !S.ended) {
        advance();
        S.nextT += stepDur();
        S.musicStep++;
      }
    }
    const horizon = now + (AE.on ? S.lookahead : 0.05);
    let guard = 0;
    while (S.nextT < horizon && guard++ < 64 && S.running && !S.ended) {
      scheduleStep(S.nextT);
      advance();
      S.nextT += stepDur();
      S.musicStep++;
    }
  }

  function advance() {
    S.pos++;
    if (S.pos >= 16) {
      S.pos = 0;
      if (!S.holding) {
        let nb;
        if (S.rec) {
          S.recIdx++;
          nb = S.recIdx < S.rec.bars.length ? S.rec.bars[S.recIdx] : -1;
        } else {
          nb = Song.nextBar(S.bar, S.flags);
        }
        if (nb < 0) {
          S.ended = true;
          pushEvent({ type: 'end', t: S.nextT + stepDur() });
          return;
        }
        S.bar = nb;
        S.barLog.push(nb);
      }
    }
    if (!S.holding) S.songSteps++;
  }

  function pushEvent(e) {
    S.events.push(e);
  }
  // 取出 t ≤ now 的事件
  function popDue(now, out) {
    out.length = 0;
    const ev = S.events;
    while (S.evHead < ev.length && ev[S.evHead].t <= now) out.push(ev[S.evHead++]);
    if (S.evHead > 512) {
      ev.splice(0, S.evHead);
      S.evHead = 0;
    }
    return out;
  }

  function info(bar, pos, held) {
    const sec = Song.sectionAt(bar);
    const barIn = bar - sec.start;
    const style = S.style;
    const lastBar = barIn === sec.bars - 1;
    const sd = stepDur();
    return {
      bar, pos, held, sec, type: sec.type, barIn, bars: sec.bars, p: barIn / sec.bars, lastBar,
      silent: sec.type === 'build' && lastBar && pos >= 12,
      chord: Song.chordAt(bar),
      nextChord: Song.chordAt(Math.min(bar + 1, Math.max(0, Song.S.totalBars - 1))),
      key: Song.keyAt(bar),
      mode: style.mode,
      feel: style.feel,
      stepDur: sd, beatDur: sd * 4, barDur: sd * 16, bpm: S.bpm,
      step: S.musicStep,
    };
  }

  // 尾声里乐器逐轨退出的顺序
  const OUTRO_KEEP = { kick: 0.9, pad: 1.01, arp: 0.75, bell: 0.75, hat: 0.25, stab: 0.25, bass: 0.5, lead: 0.5, toms: 0.5, snare: 0.5 };

  function scheduleStep(t) {
    const held = S.holding;
    const I = info(S.bar, S.pos, held);
    // 回放模式：按时间线切换编曲
    if (S.rec && !held) applyRecChanges(t);
    const arr = held && S.preview ? S.preview : S.arr;
    const swing = S.pos % 2 === 1 ? (S.style.swing || 0) * I.stepDur : 0;
    const ts = t + swing;
    pushEvent({ type: 'step', t: ts, bar: S.bar, pos: S.pos, held, I });

    if (S.mode === 'menu') {
      backingMenu(ts, I);
      return;
    }
    if (!S.noBacking) backing(ts, I, arr);

    // 玩家的乐器
    const P = S.style.P;
    for (const id of INST_ORDER) {
      const lv = arr.inst[id];
      if (!lv) continue;
      const def = INST[id];
      if (I.silent && !def.ignoreSilent) continue;
      if (I.type === 'outro' && I.p >= (OUTRO_KEEP[id] || 0.5)) continue;
      const str = def.bar(lv, I);
      const ch = str[S.pos];
      if (!ch || ch === '.') continue;
      const hits = patHits(str);
      // 节奏型密度归一化 + BPM 归一化（快歌攻击更频繁，每下伤害相应降低）
      const norm = def.noNorm ? 1 : U.clamp(Math.pow((def.ref || 4) / Math.max(1, hits), 0.7), 0.45, 2.8) * (128 / S.bpm);
      const notes = def.notes(ch, lv, I);
      const rm = !!arr.remix[id];
      for (const n of notes) {
        def.sound(ts, n, lv, I, P[def.voice] || {}, rm);
        pushEvent({ type: 'inst', t: ts, id, n, lv, held, norm, hits, I, remix: rm });
      }
    }
  }

  function applyRecChanges(t) {
    const ch = S.rec.changes;
    let changed = false;
    while (S.recIdx2 < ch.length && ch[S.recIdx2].s <= S.songSteps) {
      S.arr = ch[S.recIdx2++].arr;
      changed = true;
    }
    if (changed) AE.applyFx(S.arr.fx, 0.06, t);
  }

  // ---------- 伴奏：负责曲式感（上升音、镲片、拍手、铺底…），不参与战斗 ----------
  function backing(t, I, arr) {
    const st = S.style;
    const P = st.P;
    const own = arr.inst;
    const pos = I.pos;
    const type = I.type;
    const tier = arr.groove || 0;
    const sd = I.stepDur;

    // 铺底和弦床（玩家没有 Pad 时）
    if (!own.pad && pos === 0) {
      let cut = 1300, vel = 0.6;
      if (type === 'intro') { cut = 300 + 1100 * I.p; vel = 0.7; }
      else if (type === 'build') { cut = 700 + 2600 * I.p; vel = 0.55; }
      else if (type === 'drop') { cut = 1900; vel = 0.5; }
      else if (type === 'brk') { cut = 2200; vel = 1.05; }
      else if (type === 'outro') { cut = 1500; vel = 0.9 * (1 - I.p * 0.5); }
      const v = Harmony.voice(I.chord, S.padVoice, 52, 72);
      S.padVoice = v;
      Synth.pad(t, v, I.barDur * (I.lastBar && type === 'outro' ? 3 : 0.98), vel, P.pad, cut);
    }

    // 没有底鼓时的轻量底鼓（保证有律动），前奏 / 回落不放
    if (!own.kick && (type === 'groove' || type === 'drop' || (type === 'build' && !I.silent))) {
      const kb = INST.kick.bar(1, I);
      const ch = kb[pos];
      if (ch && ch !== '.') {
        Synth.kick(t, 0.42 * (VEL[ch] || 0.8), P.kick);
        AE.duck(t, 0.55);
      }
    }

    // 拍手 / 反拍
    if (!own.snare && !I.silent && (type === 'groove' || type === 'drop' || (type === 'build' && I.p < 0.5))) {
      if (pos === 4 || pos === 12) Synth.clap(t, 0.8, P.clap);
    }

    // 铺垫：军鼓滚奏 + 上升音 + 最后一拍静音
    if (type === 'build') {
      if (!own.snare && !I.silent && I.p >= 0.5) {
        const r = rollPattern(I, '....X.......X...');
        if (r[pos] !== '.') Synth.snare(t, 0.35 + 0.55 * (I.p + pos / 16 / I.bars), P.snare);
      }
      if (pos === 0) {
        const p0 = I.barIn / I.bars, p1 = (I.barIn + 1) / I.bars;
        Synth.riser(t, I.barDur * (I.lastBar ? 0.75 : 1), p0, I.lastBar ? 1 : p1, 0.02 + p0 * 0.16, 0.02 + p1 * 0.16);
      }
    }
    // 回落段尾巴：小上升音，引回律动
    if (type === 'brk' && I.barIn >= I.bars - 2 && pos === 0) {
      const p0 = (I.barIn - (I.bars - 2)) / 2;
      Synth.riser(t, I.barDur, p0 * 0.6, p0 * 0.6 + 0.3, 0.015 + p0 * 0.05, 0.03 + p0 * 0.06);
    }
    // 爆发段落第一拍：镲片 + 低频冲击
    if (type === 'drop' && pos === 0) {
      if (I.barIn === 0) {
        Synth.crash(t, 1, P.crash || {});
        Synth.impact(t, 1);
      } else if (I.barIn % 8 === 0) {
        Synth.crash(t, 0.5, P.crash || {});
      }
    }
    if ((type === 'groove' || type === 'brk' || type === 'outro') && pos === 0 && I.barIn === 0) Synth.crash(t, 0.4, P.crash || {});

    // 律动层
    const groovy = type === 'groove' || type === 'drop';
    if (groovy && tier >= 1) {
      Synth.shaker(t, pos % 4 === 2 ? 1 : 0.55);
    }
    if (groovy && tier >= 2 && !own.stab && (pos === 6 || pos === 14)) {
      Synth.stab(t, Harmony.voice(I.chord, null, 62, 76), 0.45, P.stab);
    }
    if (groovy && tier >= 3 && !own.hat && pos % 2 === 1) {
      Synth.hat(t, 0.35, pos % 4 === 3, P.hat);
    }
    // 节拍器效果器
    if ((arr.fx.metronome || 0) > 0 && pos % 4 === 0 && type !== 'outro') Synth.metro(t, pos === 0);
    // lo-fi 黑胶底噪
    if (st.id === 'lofi' && pos === 0) Synth.crackle(t, I.barDur, 0.06);
  }

  // 标题菜单的循环
  function backingMenu(t, I) {
    const P = S.style.P;
    const pos = I.pos;
    if (pos === 0) {
      const v = Harmony.voice(I.chord, S.padVoice, 52, 72);
      S.padVoice = v;
      Synth.pad(t, v, I.barDur * 0.98, 0.9, P.pad, 1300);
      if (S.style.id === 'lofi') Synth.crackle(t, I.barDur, 0.05);
    }
    const kb = INST.kick.bar(1, Object.assign({}, I, { type: 'groove' }));
    if (kb[pos] !== '.' && I.bar % 8 >= 2) {
      Synth.kick(t, 0.4, P.kick);
      AE.duck(t, 0.6);
    }
    if (pos % 4 === 2 && I.bar % 8 >= 4) Synth.hat(t, 0.3, true, P.hat);
    if (pos % 2 === 0) {
      const list = Harmony.arpNotes(I.chord, 64, 2);
      const m = list[(S.arpCount++ * 3) % list.length];
      if ((pos / 2 + I.bar) % 3 !== 2) Synth.pluck(t, m, I.stepDur, 0.35, P.pluck, (m % 12) / 12 - 0.5);
    }
  }

  return {
    S, start, stop, tick, hold, release, popDue, nextGrid, nextGrid32, gridSound, nearestBeat, beatPhase,
    stepDur, beatDur, barDur, info,
  };
})();
