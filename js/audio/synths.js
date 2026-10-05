'use strict';
// 合成器音色。全部实时合成，不用采样。
// 每个音色接受一个预设对象 P（由曲风提供），缺省字段用 house 的值。

const Synth = (() => {
  const C = () => AE.A.ctx;
  const Gr = () => AE.A.g;
  const on = () => AE.A.enabled;
  const mtof = Harmony.mtof;

  function gainNode(v = 0) {
    const n = C().createGain();
    n.gain.value = v;
    return n;
  }
  function osc(type, freq, t, wave) {
    const o = C().createOscillator();
    if (type === 'pulse' && wave) o.setPeriodicWave(wave);
    else o.type = type === 'pulse' ? 'square' : type;
    o.frequency.setValueAtTime(Math.min(freq, 20000), t);
    return o;
  }
  function filt(type, f, q = 0.7) {
    const n = C().createBiquadFilter();
    n.type = type;
    n.frequency.value = f;
    n.Q.value = q;
    return n;
  }
  function pan(v) {
    const p = C().createStereoPanner();
    p.pan.value = v;
    return p;
  }
  function noise(t, dur, buf) {
    const s = C().createBufferSource();
    s.buffer = buf || Gr().noise;
    const maxOff = Math.max(0, s.buffer.duration - dur - 0.02);
    s.start(t, Math.random() * maxOff, dur + 0.01);
    return s;
  }
  // 指数衰减包络（目标不能为 0）
  function perc(param, t, peak, atk, dec) {
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + atk);
    param.exponentialRampToValueAtTime(0.0001, t + atk + dec);
  }

  // 脉冲波（芯片音乐的占空比）缓存
  const pulseCache = new WeakMap();
  function pulseWave(duty) {
    const ctx = C();
    let m = pulseCache.get(ctx);
    if (!m) { m = {}; pulseCache.set(ctx, m); }
    if (m[duty]) return m[duty];
    const n = 64;
    const re = new Float32Array(n), im = new Float32Array(n);
    for (let k = 1; k < n; k++) {
      re[k] = (2 / (k * Math.PI)) * Math.sin(k * Math.PI * duty);
    }
    m[duty] = ctx.createPeriodicWave(re, im);
    return m[duty];
  }

  // ---------------- 鼓组 ----------------
  function kick(t, vel = 1, P = {}) {
    if (!on()) return;
    const g = Gr();
    const f0 = P.f0 || 165, f1 = P.f1 || 48, pd = P.pitchDecay || 0.065, dec = P.decay || 0.42;
    const o = osc(P.wave || 'sine', f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + pd);
    o.frequency.exponentialRampToValueAtTime(f1 * 0.82, t + dec);
    const a = gainNode(0);
    perc(a.gain, t, vel * (P.vol || 1), 0.0015, dec);
    o.connect(a).connect(g.kickBus);
    o.start(t);
    o.stop(t + dec + 0.05);
    // 起音咔哒
    if ((P.click || 0.35) > 0) {
      const n = noise(t, 0.02, P.chip ? g.chipNoise : null);
      const hp = filt('highpass', P.chip ? 800 : 1800);
      const ng = gainNode(0);
      perc(ng.gain, t, vel * (P.click || 0.35), 0.0005, 0.012);
      n.connect(hp).connect(ng).connect(g.kickBus);
    }
    // 次低音尾巴（重拍 / 808）
    if (P.boom) {
      const s = osc('sine', f1 * 1.02, t);
      s.frequency.exponentialRampToValueAtTime(f1 * 0.7, t + 0.9);
      const sg = gainNode(0);
      perc(sg.gain, t, vel * P.boom, 0.01, 0.9);
      s.connect(sg).connect(g.kickBus);
      s.start(t);
      s.stop(t + 1);
    }
  }

  function hat(t, vel = 1, open = false, P = {}) {
    if (!on()) return;
    const g = Gr();
    const dec = open ? P.open || 0.24 : P.closed || 0.045;
    const buf = P.chip ? g.chipNoise : P.noise ? g.noise : g.metal;
    const src = noise(t, dec + 0.05, buf);
    if (P.chip) src.playbackRate.value = open ? 1 : 1.6;
    const hp = filt('highpass', (P.hp || 7200) * 0.85, 0.9);
    const bp = filt('bandpass', P.bp || 10500, 0.5);
    const a = gainNode(0);
    perc(a.gain, t, vel * (P.vol || 0.32) * 2.8 * (open ? 0.9 : 1), 0.001, dec);
    const p = pan(P.pan !== undefined ? P.pan : (Math.random() - 0.5) * 0.5);
    src.connect(hp).connect(bp).connect(a).connect(p).connect(g.drumBus);
    if (open) a.connect(g.reverbSend);
  }

  function snare(t, vel = 1, P = {}) {
    if (!on()) return;
    const g = Gr();
    const v = vel * (P.vol || 0.6);
    // 音体
    const o = osc(P.chip ? 'square' : 'triangle', P.tone || 190, t);
    o.frequency.exponentialRampToValueAtTime((P.tone || 190) * 0.75, t + 0.08);
    const og = gainNode(0);
    perc(og.gain, t, v * (P.body || 0.55), 0.001, 0.09);
    o.connect(og).connect(g.drumBus);
    o.start(t);
    o.stop(t + 0.15);
    // 噪声
    const dec = P.decay || 0.17;
    const n = noise(t, dec + 0.05, P.chip ? g.chipNoise : null);
    const f1 = filt('highpass', P.hp || 1200);
    const f2 = filt('peaking', P.peak || 3800, 1);
    f2.gain.value = 6;
    const ng = gainNode(0);
    perc(ng.gain, t, v, 0.001, dec);
    n.connect(f1).connect(f2).connect(ng).connect(g.drumBus);
    const send = P.gated ? g.gatedSend : g.reverbSend;
    const sg = gainNode(P.gated ? 0.9 : P.verb || 0.18);
    ng.connect(sg).connect(send);
  }

  function clap(t, vel = 1, P = {}) {
    if (!on()) return;
    const g = Gr();
    const v = vel * (P.vol || 0.5);
    const bp = filt('bandpass', P.bp || 1150, 1.4);
    const a = gainNode(0);
    a.gain.setValueAtTime(0.0001, t);
    for (let i = 0; i < 3; i++) {
      const ti = t + i * 0.011;
      a.gain.setValueAtTime(v, ti);
      a.gain.exponentialRampToValueAtTime(v * 0.25, ti + 0.009);
    }
    a.gain.setValueAtTime(v, t + 0.033);
    a.gain.exponentialRampToValueAtTime(0.0001, t + 0.033 + (P.decay || 0.16));
    const n = noise(t, 0.25);
    n.connect(bp).connect(a).connect(g.drumBus);
    const sg = gainNode(P.gated ? 0.8 : 0.3);
    a.connect(sg).connect(P.gated ? g.gatedSend : g.reverbSend);
  }

  function shaker(t, vel = 1, P = {}) {
    if (!on()) return;
    const g = Gr();
    const n = noise(t, 0.08);
    const hp = filt('highpass', 5500);
    const a = gainNode(0);
    a.gain.setValueAtTime(0.0001, t);
    a.gain.linearRampToValueAtTime(vel * (P.vol || 0.09), t + 0.012);
    a.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    n.connect(hp).connect(a).connect(pan(0.35)).connect(g.drumBus);
  }

  function tom(t, midi, vel = 1, P = {}) {
    if (!on()) return;
    const g = Gr();
    const f = mtof(midi);
    const o = osc(P.chip ? 'triangle' : 'sine', f * 1.7, t);
    o.frequency.exponentialRampToValueAtTime(f, t + 0.06);
    const a = gainNode(0);
    perc(a.gain, t, vel * (P.vol || 0.55), 0.002, P.decay || 0.32);
    o.connect(a).connect(pan((midi % 7) / 7 - 0.4)).connect(g.drumBus);
    a.connect(g.reverbSend);
    o.start(t);
    o.stop(t + 0.45);
  }

  function crash(t, vel = 1, P = {}) {
    if (!on()) return;
    const g = Gr();
    const dec = P.decay || 2.2;
    const n = noise(t, dec + 0.1, P.chip ? g.chipNoise : null);
    const hp = filt('highpass', 4200);
    const a = gainNode(0);
    perc(a.gain, t, vel * (P.vol || 0.28), 0.002, dec);
    n.connect(hp).connect(a).connect(g.fxBus);
    a.connect(g.reverbSend);
  }

  function impact(t, vel = 1) {
    if (!on()) return;
    const g = Gr();
    const o = osc('sine', 90, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 1.1);
    const a = gainNode(0);
    perc(a.gain, t, vel * 0.85, 0.005, 1.2);
    o.connect(a).connect(g.fxBus);
    o.start(t);
    o.stop(t + 1.3);
    const n = noise(t, 0.5);
    const lp = filt('lowpass', 900);
    const ng = gainNode(0);
    perc(ng.gain, t, vel * 0.5, 0.002, 0.4);
    n.connect(lp).connect(ng).connect(g.fxBus);
    ng.connect(g.reverbSend);
  }

  // 上升音：按小节分段调度（hold 循环时会重放同一段，不会越升越高）
  function riser(t, dur, p0, p1, v0, v1) {
    if (!on()) return;
    const g = Gr();
    const n = noise(t, dur + 0.05);
    const bp = filt('bandpass', 350 * Math.pow(2, p0 * 5), 2.5);
    bp.frequency.exponentialRampToValueAtTime(350 * Math.pow(2, p1 * 5), t + dur);
    const a = gainNode(0);
    a.gain.setValueAtTime(Math.max(0.0001, v0), t);
    a.gain.linearRampToValueAtTime(Math.max(0.0001, v1), t + dur - 0.01);
    a.gain.linearRampToValueAtTime(0.0001, t + dur + 0.02);
    n.connect(bp).connect(a).connect(g.fxBus);
    a.connect(g.reverbSend);
    // 音高上升的锯齿
    const o = osc('sawtooth', 110 * Math.pow(2, p0 * 2), t);
    o.frequency.exponentialRampToValueAtTime(110 * Math.pow(2, p1 * 2), t + dur);
    const lp = filt('lowpass', 1200 + p1 * 4000, 1);
    const og = gainNode(0);
    og.gain.setValueAtTime(Math.max(0.0001, v0 * 0.25), t);
    og.gain.linearRampToValueAtTime(Math.max(0.0001, v1 * 0.25), t + dur - 0.01);
    og.gain.linearRampToValueAtTime(0.0001, t + dur + 0.02);
    o.connect(lp).connect(og).connect(g.fxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  // 黑胶底噪（lo-fi）
  function crackle(t, dur, vol = 0.05) {
    if (!on()) return;
    const g = Gr();
    let b = g._crackle;
    if (!b) {
      const sr = C().sampleRate, len = Math.floor(sr * 4);
      b = C().createBuffer(1, len, sr);
      const d = b.getChannelData(0);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp = lp * 0.97 + (Math.random() * 2 - 1) * 0.03;
        d[i] = lp * 0.6 + (Math.random() < 0.0007 ? (Math.random() * 2 - 1) * 0.9 : 0);
      }
      g._crackle = b;
    }
    const s = noise(t, dur, b);
    const a = gainNode(vol);
    s.connect(a).connect(g.fxBus);
  }

  // ---------------- 有音高的乐器 ----------------
  function bass(t, midi, dur, vel = 1, P = {}, opt = {}) {
    if (!on()) return;
    const g = Gr();
    const f = mtof(midi);
    const v = vel * (P.vol || 0.42);
    const end = t + dur;
    const lp = filt('lowpass', P.cutoff || 260, P.q || 7);
    const env = P.envAmt !== undefined ? P.envAmt : 1500;
    const fdec = P.fdecay || 0.16;
    lp.frequency.setValueAtTime((P.cutoff || 260) + env, t);
    lp.frequency.setTargetAtTime(P.cutoff || 260, t + 0.005, fdec / 3);
    const a = gainNode(0);
    a.gain.setValueAtTime(0.0001, t);
    a.gain.linearRampToValueAtTime(v, t + 0.004);
    a.gain.setValueAtTime(v * (P.sustain || 0.85), end - 0.02);
    a.gain.exponentialRampToValueAtTime(0.0001, end + (P.rel || 0.06));
    const oscs = [];
    const w = P.wave || 'sawtooth';
    const pw = w === 'pulse' ? pulseWave(P.duty || 0.5) : null;
    if (P.reese) {
      [-14, 14].forEach((dt) => {
        const o = osc('sawtooth', f, t);
        o.detune.value = dt;
        oscs.push(o);
      });
    } else {
      oscs.push(osc(w, f, t, pw));
    }
    if (P.sub) {
      const s = osc(P.sub, f / 2, t);
      const sg = gainNode(P.subVol || 0.7);
      s.connect(sg).connect(a);
      s.start(t);
      s.stop(end + 0.15);
    }
    oscs.forEach((o) => { o.connect(lp); o.start(t); o.stop(end + 0.15); });
    // 长音：滤波 wobble
    if (opt.wobble) {
      const lfo = osc('sine', opt.wobble, t);
      const d = gainNode(0);
      d.gain.setValueAtTime(0, t);
      d.gain.linearRampToValueAtTime((P.cutoff || 260) * 3.2, t + Math.min(0.2, dur));
      lfo.connect(d).connect(lp.frequency);
      lfo.start(t);
      lfo.stop(end + 0.1);
    }
    lp.connect(a).connect(g.musicBus);
  }

  function pluck(t, midi, dur, vel = 1, P = {}, panV = 0) {
    if (!on()) return;
    const g = Gr();
    const f = mtof(midi);
    const v = vel * (P.vol || 0.16) * 1.25;
    const dec = P.decay || 0.17;
    const w = P.wave || 'sawtooth';
    const pw = w === 'pulse' ? pulseWave(P.duty || 0.25) : null;
    const lp = filt('lowpass', 20000, P.q || 3);
    const co = P.cutoff || 700, ea = P.envAmt !== undefined ? P.envAmt : 3800;
    if (co < 15000) {
      lp.frequency.setValueAtTime(co + ea, t);
      lp.frequency.exponentialRampToValueAtTime(co, t + dec);
    }
    const a = gainNode(0);
    a.gain.setValueAtTime(0.0001, t);
    a.gain.linearRampToValueAtTime(v, t + 0.003);
    a.gain.exponentialRampToValueAtTime(v * (P.sustain || 0.25), t + dec);
    const end = t + Math.max(dur, dec);
    a.gain.setValueAtTime(v * (P.sustain || 0.25), end);
    a.gain.exponentialRampToValueAtTime(0.0001, end + (P.rel || 0.12));
    const det = P.detune !== undefined ? P.detune : 9;
    const n = det ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const o = osc(w, f, t, pw);
      o.detune.value = n === 2 ? (i ? det : -det) : 0;
      o.connect(lp);
      o.start(t);
      o.stop(end + 0.2);
    }
    // 电钢（FM 起音）
    if (P.fmBell) {
      const m = osc('sine', f * 14, t);
      const mg = gainNode(0);
      perc(mg.gain, t, f * 1.2, 0.001, 0.05);
      const c = osc('sine', f, t);
      m.connect(mg).connect(c.frequency);
      const cg = gainNode(0);
      perc(cg.gain, t, v * 0.6, 0.002, dec * 1.5);
      c.connect(cg).connect(a);
      m.start(t); c.start(t);
      m.stop(end + 0.2); c.stop(end + 0.2);
    }
    const p = pan(panV);
    lp.connect(a).connect(p).connect(g.musicBus);
    const ds = gainNode(P.delay !== undefined ? P.delay : 0.32);
    a.connect(ds).connect(g.delaySend);
    const rs = gainNode(P.verb !== undefined ? P.verb : 0.16);
    a.connect(rs).connect(g.reverbSend);
  }

  function lead(t, midi, dur, vel = 1, P = {}, glideFrom = null) {
    if (!on()) return;
    const g = Gr();
    const f = mtof(midi);
    const v = vel * (P.vol || 0.12);
    const end = t + dur;
    const w = P.wave || 'sawtooth';
    const pw = w === 'pulse' ? pulseWave(P.duty || 0.5) : null;
    const lp = filt('lowpass', P.cutoff || 3200, 1.5);
    const a = gainNode(0);
    a.gain.setValueAtTime(0.0001, t);
    a.gain.linearRampToValueAtTime(v, t + (P.attack || 0.012));
    a.gain.setValueAtTime(v * 0.8, end - 0.01);
    a.gain.exponentialRampToValueAtTime(0.0001, end + (P.rel || 0.15));
    const vib = osc('sine', P.vibRate || 5.2, t);
    const vg = gainNode(0);
    vg.gain.setValueAtTime(0, t);
    vg.gain.linearRampToValueAtTime(P.vibDepth || 9, t + Math.min(dur, 0.35));
    vib.connect(vg);
    [-6, 6].forEach((dt) => {
      const o = osc(w, glideFrom ? mtof(glideFrom) : f, t, pw);
      if (glideFrom) o.frequency.exponentialRampToValueAtTime(f, t + (P.glide || 0.05));
      o.detune.value = dt;
      vg.connect(o.detune);
      o.connect(lp);
      o.start(t);
      o.stop(end + 0.25);
    });
    vib.start(t);
    vib.stop(end + 0.25);
    lp.connect(a).connect(g.musicBus);
    const ds = gainNode(0.28);
    a.connect(ds).connect(g.delaySend);
    const rs = gainNode(0.22);
    a.connect(rs).connect(g.reverbSend);
  }

  function pad(t, midis, dur, vel = 1, P = {}, cutoff = null) {
    if (!on()) return;
    const g = Gr();
    const v = vel * (P.vol || 0.055);
    const atk = P.attack || 0.35, rel = P.rel || 0.9;
    const end = t + dur;
    const lp = filt('lowpass', cutoff || P.cutoff || 1500, 0.8);
    const a = gainNode(0);
    a.gain.setValueAtTime(0.0001, t);
    a.gain.linearRampToValueAtTime(v, t + atk);
    a.gain.setValueAtTime(v, end);
    a.gain.exponentialRampToValueAtTime(0.0001, end + rel);
    const w = P.wave || 'sawtooth';
    const pw = w === 'pulse' ? pulseWave(P.duty || 0.5) : null;
    const det = P.detune !== undefined ? P.detune : 13;
    midis.forEach((m, i) => {
      const f = mtof(m);
      for (let k = 0; k < (P.voices || 2); k++) {
        const o = osc(w, f, t, pw);
        o.detune.value = (k ? det : -det) + (i - 1.5) * 2;
        o.connect(lp);
        o.start(t);
        o.stop(end + rel + 0.1);
      }
    });
    lp.connect(a).connect(g.padBus);
    const rs = gainNode(P.verb !== undefined ? P.verb : 0.45);
    a.connect(rs).connect(g.reverbSend);
  }

  function stab(t, midis, vel = 1, P = {}) {
    if (!on()) return;
    const g = Gr();
    const v = vel * (P.vol || 0.07) * 1.3;
    const dec = P.decay || 0.24;
    const lp = filt('lowpass', 800, 2);
    lp.frequency.setValueAtTime(P.cutoff || 3800, t);
    lp.frequency.exponentialRampToValueAtTime(600, t + dec);
    const a = gainNode(0);
    perc(a.gain, t, v, 0.002, dec);
    const w = P.wave || 'sawtooth';
    const pw = w === 'pulse' ? pulseWave(P.duty || 0.5) : null;
    midis.forEach((m) => {
      [-8, 8].forEach((dt) => {
        const o = osc(w, mtof(m), t, pw);
        o.detune.value = dt;
        o.connect(lp);
        o.start(t);
        o.stop(t + dec + 0.1);
      });
    });
    lp.connect(a).connect(g.musicBus);
    const rs = gainNode(0.3);
    a.connect(rs).connect(g.reverbSend);
    const ds = gainNode(0.18);
    a.connect(ds).connect(g.delaySend);
  }

  // FM 钟声
  function bell(t, midi, vel = 1, P = {}) {
    if (!on()) return;
    const g = Gr();
    const f = mtof(midi);
    const v = vel * (P.vol || 0.13) * 1.9;
    const dec = P.decay || 0.9;
    const m = osc('sine', f * (P.ratio || 3.5), t);
    const mg = gainNode(0);
    perc(mg.gain, t, f * (P.index || 2.2), 0.001, dec * 0.6);
    const c = osc(P.chip ? 'triangle' : 'sine', f, t);
    m.connect(mg).connect(c.frequency);
    const a = gainNode(0);
    perc(a.gain, t, v, 0.001, dec);
    c.connect(a).connect(pan(((midi % 12) / 12 - 0.5) * 0.8)).connect(g.musicBus);
    const rs = gainNode(0.35);
    a.connect(rs).connect(g.reverbSend);
    const ds = gainNode(0.22);
    a.connect(ds).connect(g.delaySend);
    m.start(t); c.start(t);
    m.stop(t + dec + 0.1); c.stop(t + dec + 0.1);
  }

  // ---------------- 游戏音效（量化后调度）----------------
  function glass(t, midi, vel = 1) {
    if (!on()) return;
    const g = Gr();
    const f = mtof(midi);
    const o = osc('triangle', f, t);
    const o2 = osc('sine', f * 2.01, t);
    const a = gainNode(0);
    perc(a.gain, t, 0.05 * vel, 0.001, 0.16);
    const a2 = gainNode(0);
    perc(a2.gain, t, 0.02 * vel, 0.001, 0.08);
    o.connect(a).connect(g.sfxBus);
    o2.connect(a2).connect(g.sfxBus);
    a.connect(g.sfxVerb);
    o.start(t); o2.start(t);
    o.stop(t + 0.2); o2.stop(t + 0.2);
  }
  function pickup(t, midi) {
    if (!on()) return;
    const g = Gr();
    const f = mtof(midi);
    const o = osc('sine', f, t);
    const a = gainNode(0);
    perc(a.gain, t, 0.07, 0.002, 0.11);
    o.connect(a).connect(g.sfxBus);
    a.connect(g.sfxVerb);
    o.start(t);
    o.stop(t + 0.15);
  }
  function dash(t, perfect) {
    if (!on()) return;
    const g = Gr();
    const n = noise(t, 0.2);
    const bp = filt('bandpass', 700, 2.5);
    bp.frequency.exponentialRampToValueAtTime(perfect ? 4200 : 2600, t + 0.13);
    const a = gainNode(0);
    a.gain.setValueAtTime(0.0001, t);
    a.gain.linearRampToValueAtTime(0.16, t + 0.03);
    a.gain.exponentialRampToValueAtTime(0.0001, t + 0.17);
    n.connect(bp).connect(a).connect(g.sfxBus);
  }
  function perfect(t, midis) {
    if (!on()) return;
    const g = Gr();
    midis.forEach((m, i) => {
      const o = osc('triangle', mtof(m), t);
      const a = gainNode(0);
      perc(a.gain, t, 0.06, 0.002, 0.45);
      o.connect(a).connect(g.sfxBus);
      a.connect(g.sfxVerb);
      o.start(t);
      o.stop(t + 0.5);
    });
  }
  function woodblock(t, vel = 1, high = false) {
    if (!on()) return;
    const g = Gr();
    const f = high ? 1500 : 1050;
    [1, 1.52].forEach((k, i) => {
      const o = osc('sine', f * k, t);
      const a = gainNode(0);
      perc(a.gain, t, vel * (i ? 0.05 : 0.11), 0.001, 0.05);
      o.connect(a).connect(g.drumBus);
      o.start(t);
      o.stop(t + 0.08);
    });
  }
  function metro(t, accent) {
    if (!on()) return;
    const g = Gr();
    const o = osc('sine', accent ? 2400 : 1800, t);
    const a = gainNode(0);
    perc(a.gain, t, accent ? 0.05 : 0.03, 0.001, 0.025);
    o.connect(a).connect(g.drumBus);
    o.start(t);
    o.stop(t + 0.05);
  }
  function wub(t, midi, dur = 0.45, vel = 1) {
    if (!on()) return;
    const g = Gr();
    const f = mtof(midi);
    const o = osc('sawtooth', f, t);
    const s = osc('sine', f, t);
    const lp = filt('lowpass', 200, 8);
    lp.frequency.setValueAtTime(200, t);
    lp.frequency.linearRampToValueAtTime(1400, t + dur * 0.3);
    lp.frequency.exponentialRampToValueAtTime(150, t + dur);
    const a = gainNode(0);
    a.gain.setValueAtTime(0.0001, t);
    a.gain.linearRampToValueAtTime(0.3 * vel, t + 0.01);
    a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(lp);
    s.connect(a);
    lp.connect(a).connect(g.fxBus);
    o.start(t); s.start(t);
    o.stop(t + dur + 0.05); s.stop(t + dur + 0.05);
  }
  function zap(t, vel = 1) {
    if (!on()) return;
    const g = Gr();
    const o = osc('sawtooth', 2200, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.22);
    const lp = filt('lowpass', 5000, 3);
    const a = gainNode(0);
    perc(a.gain, t, 0.12 * vel, 0.002, 0.24);
    o.connect(lp).connect(a).connect(g.fxBus);
    o.start(t);
    o.stop(t + 0.3);
  }
  function warn(t, midi) {
    if (!on()) return;
    const g = Gr();
    const o = osc('square', mtof(midi), t);
    const lp = filt('lowpass', 2500);
    const a = gainNode(0);
    perc(a.gain, t, 0.035, 0.002, 0.09);
    o.connect(lp).connect(a).connect(g.sfxBus);
    o.start(t);
    o.stop(t + 0.12);
  }
  function hurt(t) {
    if (!on()) return;
    const g = Gr();
    const o = osc('sawtooth', 220, t);
    o.frequency.exponentialRampToValueAtTime(55, t + 0.25);
    const lp = filt('lowpass', 900, 4);
    const a = gainNode(0);
    perc(a.gain, t, 0.22, 0.002, 0.26);
    o.connect(lp).connect(a).connect(g.sfxBus);
    o.start(t);
    o.stop(t + 0.3);
    const n = noise(t, 0.12);
    const ng = gainNode(0);
    perc(ng.gain, t, 0.15, 0.001, 0.1);
    n.connect(ng).connect(g.sfxBus);
  }
  // 升级进入 hold 时的“倒带”声
  function rewind(t) {
    if (!on()) return;
    const g = Gr();
    const n = noise(t, 0.45);
    const bp = filt('bandpass', 4000, 4);
    bp.frequency.exponentialRampToValueAtTime(300, t + 0.4);
    const a = gainNode(0);
    a.gain.setValueAtTime(0.0001, t);
    a.gain.linearRampToValueAtTime(0.12, t + 0.05);
    a.gain.exponentialRampToValueAtTime(0.0001, t + 0.42);
    n.connect(bp).connect(a).connect(g.sfxBus);
  }
  function swoosh(t) {
    if (!on()) return;
    const g = Gr();
    const n = noise(t, 0.5);
    const bp = filt('bandpass', 400, 3);
    bp.frequency.exponentialRampToValueAtTime(6000, t + 0.4);
    const a = gainNode(0);
    a.gain.setValueAtTime(0.0001, t);
    a.gain.linearRampToValueAtTime(0.1, t + 0.35);
    a.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    n.connect(bp).connect(a).connect(g.sfxBus);
  }
  function ui(kind, midi = 84) {
    if (!on()) return;
    const g = Gr();
    const t = C().currentTime + 0.005;
    if (kind === 'move') {
      const o = osc('sine', mtof(midi), t);
      const a = gainNode(0);
      perc(a.gain, t, 0.05, 0.001, 0.05);
      o.connect(a).connect(g.sfxBus);
      o.start(t); o.stop(t + 0.08);
    } else if (kind === 'select') {
      [0, 4, 7, 12].forEach((iv, i) => {
        const o = osc('triangle', mtof(midi + iv), t + i * 0.035);
        const a = gainNode(0);
        perc(a.gain, t + i * 0.035, 0.06, 0.002, 0.3);
        o.connect(a).connect(g.sfxBus);
        a.connect(g.sfxVerb);
        o.start(t + i * 0.035); o.stop(t + i * 0.035 + 0.35);
      });
    } else if (kind === 'back') {
      const o = osc('triangle', mtof(midi), t);
      o.frequency.exponentialRampToValueAtTime(mtof(midi - 12), t + 0.12);
      const a = gainNode(0);
      perc(a.gain, t, 0.06, 0.002, 0.14);
      o.connect(a).connect(g.sfxBus);
      o.start(t); o.stop(t + 0.2);
    } else if (kind === 'deny') {
      const o = osc('square', 110, t);
      const lp = filt('lowpass', 800);
      const a = gainNode(0);
      perc(a.gain, t, 0.05, 0.002, 0.12);
      o.connect(lp).connect(a).connect(g.sfxBus);
      o.start(t); o.stop(t + 0.15);
    } else if (kind === 'coin') {
      [0, 7].forEach((iv, i) => {
        const o = osc('square', mtof(midi + iv), t + i * 0.07);
        const lp = filt('lowpass', 3000);
        const a = gainNode(0);
        perc(a.gain, t + i * 0.07, 0.04, 0.002, 0.2);
        o.connect(lp).connect(a).connect(g.sfxBus);
        o.start(t + i * 0.07); o.stop(t + i * 0.07 + 0.25);
      });
    }
  }

  return {
    kick, hat, snare, clap, shaker, tom, crash, impact, riser, crackle,
    bass, pluck, lead, pad, stab, bell,
    glass, pickup, dash, perfect, woodblock, metro, wub, zap, warn, hurt, rewind, swoosh, ui,
  };
})();
