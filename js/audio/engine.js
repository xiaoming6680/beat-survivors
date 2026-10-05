'use strict';
// 音频引擎：AudioContext、总线与效果链、听感时钟。
// 图（graph）是一个对象，可以针对实时 AudioContext 或 OfflineAudioContext（导出 WAV）分别构建。

const AE = (() => {
  const A = {
    ctx: null,       // 当前在用的上下文（实时或离线）
    g: null,         // 当前图
    live: null,      // 实时上下文的图
    enabled: false,  // false = 模拟模式，不发声
    vol: { master: 0.8, music: 1, sfx: 0.8 },
    fxLv: {},        // 当前效果器等级（含试听）
    bpm: 128,
    style: null,
  };

  // ---------- 工具 ----------
  function softCurve(k, n = 2048) {
    const c = new Float32Array(n);
    const norm = Math.tanh(k);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      c[i] = Math.tanh(k * x) / norm;
    }
    return c;
  }
  function makeNoise(ctx, sec) {
    const len = Math.floor(ctx.sampleRate * sec);
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return b;
  }
  // 808 式金属音：6 个非谐比方波 + 少量噪声
  function makeMetal(ctx, sec) {
    const sr = ctx.sampleRate, len = Math.floor(sr * sec);
    const b = ctx.createBuffer(1, len, sr);
    const d = b.getChannelData(0);
    const fr = [2, 3, 4.16, 5.43, 6.79, 8.21].map((k) => 205.3 * k);
    for (let i = 0; i < len; i++) {
      const t = i / sr;
      let s = 0;
      for (const f of fr) s += Math.sin(TAU * f * t) > 0 ? 1 : -1;
      d[i] = s / 6 * 0.7 + (Math.random() * 2 - 1) * 0.3;
    }
    return b;
  }
  // 芯片音乐的周期噪声（15 位 LFSR，降采样）
  function makeChipNoise(ctx, sec) {
    const sr = ctx.sampleRate, len = Math.floor(sr * sec);
    const b = ctx.createBuffer(1, len, sr);
    const d = b.getChannelData(0);
    let lfsr = 1, v = 1, hold = 0;
    const holdN = Math.max(1, Math.round(sr / 16000));
    for (let i = 0; i < len; i++) {
      if (hold-- <= 0) {
        hold = holdN;
        const bit = (lfsr ^ (lfsr >> 1)) & 1;
        lfsr = (lfsr >> 1) | (bit << 14);
        v = lfsr & 1 ? 1 : -1;
      }
      d[i] = v * 0.8;
    }
    return b;
  }
  // 程序生成的混响脉冲响应：立体声指数衰减噪声，越往后越暗
  function makeIR(ctx, sec, decay, gated = false) {
    const sr = ctx.sampleRate, len = Math.floor(sr * sec);
    const b = ctx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const n = Math.random() * 2 - 1;
        const a = 0.1 + 0.8 * t;
        lp = lp * a + n * (1 - a);
        const env = gated ? (t < 0.85 ? 1 - t * 0.3 : (1 - t) / 0.15 * 0.7) : Math.pow(1 - t, decay);
        const pre = i < sr * 0.008 ? i / (sr * 0.008) : 1;
        d[i] = lp * env * pre * (gated ? 1.6 : 1.2);
      }
    }
    return b;
  }

  // ---------- 构建图 ----------
  function buildGraph(ctx) {
    const g = { ctx };
    const G = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    const comp = (th, knee, ratio, atk, rel) => {
      const c = ctx.createDynamicsCompressor();
      c.threshold.value = th; c.knee.value = knee; c.ratio.value = ratio; c.attack.value = atk; c.release.value = rel;
      return c;
    };
    g.noise = makeNoise(ctx, 2);
    g.metal = makeMetal(ctx, 0.8);
    g.chipNoise = makeChipNoise(ctx, 1);

    // 输出段
    g.master = G(A.vol.master);
    g.limiter = comp(-1.5, 0, 20, 0.002, 0.12);
    g.limiter.connect(g.master);
    g.master.connect(ctx.destination);
    if (ctx.createAnalyser && !(ctx instanceof (window.OfflineAudioContext || Object))) {
      g.analyser = ctx.createAnalyser();
      g.analyser.fftSize = 512;
      g.analyser.smoothingTimeConstant = 0.7;
      g.master.connect(g.analyser);
      g.freq = new Uint8Array(g.analyser.frequencyBinCount);
    }
    g.musicOut = G(A.vol.music);
    g.sfxOut = G(A.vol.sfx);
    g.musicOut.connect(g.limiter);
    g.sfxOut.connect(g.limiter);

    // 音乐链：mix → LFO 滤波 → hold 低通 → 失真（干/湿并联）→ 胶水压缩 → musicOut
    g.glue = comp(-14, 6, 2.5, 0.008, 0.2);
    g.glue.connect(g.musicOut);
    g.preDrive = G(1);
    g.driveDry = G(1);
    g.driveWet = G(0);
    g.shaper = ctx.createWaveShaper();
    g.shaper.curve = softCurve(4);
    g.shaper.oversample = '2x';
    g.excite = ctx.createBiquadFilter();
    g.excite.type = 'highshelf';
    g.excite.frequency.value = 5500;
    g.excite.gain.value = 0;
    g.excite.connect(g.glue);
    g.preDrive.connect(g.driveDry).connect(g.excite);
    g.preDrive.connect(g.shaper).connect(g.driveWet).connect(g.excite);
    g.holdLP = ctx.createBiquadFilter();
    g.holdLP.type = 'lowpass';
    g.holdLP.frequency.value = 20000;
    g.holdLP.Q.value = 0.7;
    g.holdLP.connect(g.preDrive);
    g.lfoLP = ctx.createBiquadFilter();
    g.lfoLP.type = 'lowpass';
    g.lfoLP.frequency.value = 20000;
    g.lfoLP.Q.value = 1.5;
    g.lfoLP.connect(g.holdLP);
    g.lfoOsc = ctx.createOscillator();
    g.lfoOsc.frequency.value = 0.12;
    g.lfoDepth = G(0);
    g.lfoOsc.connect(g.lfoDepth).connect(g.lfoLP.frequency);
    g.lfoOsc.start();
    g.mix = G(1);
    g.mix.connect(g.lfoLP);

    // 底鼓：轻度饱和，不被侧链
    g.kickBus = G(1);
    g.kickShaper = ctx.createWaveShaper();
    g.kickShaper.curve = softCurve(1.6);
    g.kickBus.connect(g.kickShaper).connect(g.mix);
    // 鼓组 / 打击乐
    g.drumBus = G(1);
    g.drumBus.connect(g.mix);
    // 旋律与低音：被底鼓侧链
    g.musicBus = G(1);
    g.duck = G(1);
    g.musicBus.connect(g.duck).connect(g.mix);
    g.padBus = G(1);
    g.duckPad = G(1);
    g.padBus.connect(g.duckPad).connect(g.mix);
    // 演出类（上升音、镲片、冲击）
    g.fxBus = G(1);
    g.fxBus.connect(g.mix);

    // 合唱：两条被 LFO 调制的短延迟
    g.chorusIn = G(1);
    g.chorusWet = G(0);
    g.duck.connect(g.chorusIn);
    g.duckPad.connect(g.chorusIn);
    [[0.011, 0.6, -0.8], [0.017, 0.83, 0.8]].forEach(([base, rate, pan]) => {
      const d = ctx.createDelay(0.05);
      d.delayTime.value = base;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = rate;
      const depth = G(0.0035);
      lfo.connect(depth).connect(d.delayTime);
      lfo.start();
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.chorusIn.connect(d).connect(p).connect(g.chorusWet);
    });
    g.chorusWet.connect(g.mix);

    // 混响
    g.reverbSend = G(1);
    g.convolver = ctx.createConvolver();
    g.convolver.buffer = makeIR(ctx, 2.8, 2.6);
    g.reverbRet = G(0.25);
    g.reverbSend.connect(g.convolver).connect(g.reverbRet).connect(g.mix);
    // 门限混响（synthwave 军鼓）
    g.gatedSend = G(1);
    g.gatedConv = ctx.createConvolver();
    g.gatedConv.buffer = makeIR(ctx, 0.42, 1, true);
    g.gatedRet = G(0.6);
    g.gatedSend.connect(g.gatedConv).connect(g.gatedRet).connect(g.mix);

    // 乒乓延迟（附点八分）
    g.delaySend = G(1);
    g.dlL = ctx.createDelay(2);
    g.dlR = ctx.createDelay(2);
    g.dlFbL = G(0.3);
    g.dlFbR = G(0.3);
    g.dlTone = ctx.createBiquadFilter();
    g.dlTone.type = 'bandpass';
    g.dlTone.frequency.value = 1800;
    g.dlTone.Q.value = 0.4;
    const pL = ctx.createStereoPanner(); pL.pan.value = -0.7;
    const pR = ctx.createStereoPanner(); pR.pan.value = 0.7;
    g.delayRet = G(0.4);
    g.delaySend.connect(g.dlTone).connect(g.dlL);
    g.dlL.connect(pL).connect(g.delayRet);
    g.dlL.connect(g.dlFbL).connect(g.dlR);
    g.dlR.connect(pR).connect(g.delayRet);
    g.dlR.connect(g.dlFbR).connect(g.dlL);
    g.delayRet.connect(g.mix);

    // 音效（不受 hold 低通影响）
    g.sfxBus = G(1);
    g.sfxBus.connect(g.sfxOut);
    g.sfxVerb = G(0.5);
    g.sfxVerb.connect(g.reverbSend);

    g.holdBase = 20000;
    g.duckDepth = 0.4;
    g.padDuckDepth = 0.55;
    return g;
  }

  // ---------- 听感时钟 ----------
  const Clock = {
    mode: 'audio',
    vt: 0,
    last: 0,
    offset: null,
    calib: 0, // 用户延迟校准（秒），正值 = 我实际听到得更晚
    now() {
      if (this.mode === 'virtual') return this.vt;
      const ctx = A.live && A.live.ctx;
      if (!ctx || ctx.state !== 'running') return this.last;
      const perf = performance.now() / 1000;
      let est;
      const ts = ctx.getOutputTimestamp ? ctx.getOutputTimestamp() : null;
      if (ts && ts.performanceTime > 0 && ts.contextTime > 0) {
        est = ts.contextTime + (perf - ts.performanceTime / 1000);
      } else {
        est = ctx.currentTime - (ctx.outputLatency || 0.02) - (ctx.baseLatency || 0);
      }
      est -= this.calib;
      const off = est - perf;
      if (this.offset === null || Math.abs(off - this.offset) > 0.04) this.offset = off;
      else this.offset += (off - this.offset) * 0.02;
      let t = perf + this.offset;
      if (t > ctx.currentTime) t = ctx.currentTime;
      if (t < this.last) t = this.last;
      this.last = t;
      return t;
    },
    // 把某个 performance.now() 时间戳换算到听感时间（踩拍判定用）
    fromPerf(perfMs) {
      if (this.mode === 'virtual') return this.vt;
      if (this.offset === null) return this.now();
      return perfMs / 1000 + this.offset;
    },
    // 调度用的“现在”：实时 = currentTime；模拟 = 虚拟时间
    sched() {
      if (this.mode === 'virtual') return this.vt;
      return A.ctx ? A.ctx.currentTime : 0;
    },
  };

  // ---------- 对外 ----------
  function init() {
    if (A.live) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC({ latencyHint: 'interactive' });
    A.live = buildGraph(ctx);
    A.ctx = ctx;
    A.g = A.live;
    A.enabled = true;
    Clock.mode = 'audio';
    return true;
  }
  function useVirtual() {
    A.enabled = false;
    Clock.mode = 'virtual';
    Clock.vt = 0;
  }
  function resume() {
    if (A.live && A.live.ctx.state !== 'running') return A.live.ctx.resume();
    return Promise.resolve();
  }
  function suspend() {
    if (A.live && A.live.ctx.state === 'running') return A.live.ctx.suspend();
    return Promise.resolve();
  }

  function setVolumes(v) {
    Object.assign(A.vol, v);
    if (!A.live) return;
    const t = A.live.ctx.currentTime;
    A.live.master.gain.setTargetAtTime(A.vol.master, t, 0.03);
    A.live.musicOut.gain.setTargetAtTime(A.vol.music, t, 0.03);
    A.live.sfxOut.gain.setTargetAtTime(A.vol.sfx, t, 0.03);
  }

  // 风格（曲风）相关的全局参数：延迟时间、LFO 速度、混响基础量
  function setStyle(style) {
    A.style = style;
    A.bpm = style.bpm;
    const g = A.g;
    if (!g || !A.enabled) return;
    const beat = 60 / style.bpm;
    g.dlL.delayTime.value = beat * 0.75;
    g.dlR.delayTime.value = beat * 0.75;
    g.lfoOsc.frequency.value = style.bpm / 60 / 8;
    applyFx(A.fxLv, 0.01);
  }

  // 效果器等级 → 混音参数（试听时也走这里）
  const DRIVE_WET = [0, 0.16, 0.28, 0.4, 0.52, 0.66];
  function applyFx(lv, ramp = 0.06, at) {
    A.fxLv = Object.assign({}, lv);
    const g = A.g;
    if (!g || !A.enabled) return;
    const t = at !== undefined ? Math.max(at, g.ctx.currentTime) : g.ctx.currentTime;
    const L = (k) => lv[k] || 0;
    const st = A.style || { reverb: 0.22 };
    const set = (param, v) => param.setTargetAtTime(v, t, ramp);
    set(g.driveWet.gain, DRIVE_WET[L('overdrive')]);
    set(g.driveDry.gain, 1 - DRIVE_WET[L('overdrive')] * 0.45);
    set(g.reverbRet.gain, (st.reverb || 0.22) + 0.075 * L('reverb'));
    set(g.dlFbL.gain, 0.24 + 0.08 * L('delay'));
    set(g.dlFbR.gain, 0.24 + 0.08 * L('delay'));
    set(g.delayRet.gain, 0.32 + 0.07 * L('delay'));
    set(g.chorusWet.gain, 0.16 * L('chorus'));
    set(g.glue.threshold, -14 - 2.5 * L('compressor'));
    set(g.glue.ratio, 2.5 + 0.7 * L('compressor'));
    g.duckDepth = 0.38 + 0.09 * L('sidechain');
    g.padDuckDepth = 0.5 + 0.08 * L('sidechain');
    const lfo = L('lfo');
    set(g.lfoLP.frequency, lfo ? 6500 : 20000);
    set(g.lfoDepth.gain, lfo * 1100);
    set(g.excite.gain, 1.6 * L('exciter'));
    set(g.preDrive.gain, 1 + 0.05 * L('mastering'));
  }

  // 侧链：在底鼓的时刻把旋律总线压下去再放开
  function duck(t, amount = 1) {
    const g = A.g;
    if (!A.enabled) return;
    const d = Math.min(0.9, g.duckDepth * amount);
    const dp = Math.min(0.92, g.padDuckDepth * amount);
    g.duck.gain.setTargetAtTime(1 - d, t, 0.004);
    g.duck.gain.setTargetAtTime(1, t + 0.03, 0.085);
    g.duckPad.gain.setTargetAtTime(1 - dp, t, 0.005);
    g.duckPad.gain.setTargetAtTime(1, t + 0.04, 0.11);
  }

  // hold：DJ 式低通保持
  function setHold(on) {
    const g = A.g;
    if (!A.enabled) return;
    const t = g.ctx.currentTime;
    g.holdBase = on ? 900 : 20000;
    g.holdLP.frequency.setTargetAtTime(g.holdBase, t, on ? 0.05 : 0.18);
    g.holdLP.Q.setTargetAtTime(on ? 4 : 0.7, t, 0.08);
    g.mix.gain.setTargetAtTime(on ? 0.85 : 1, t, 0.1);
  }
  // 受击：低通瞬间压下再回来
  function hitDip(strength = 1) {
    const g = A.g;
    if (!A.enabled) return;
    const t = g.ctx.currentTime;
    g.holdLP.frequency.setTargetAtTime(Math.min(g.holdBase, 380), t, 0.006);
    g.holdLP.frequency.setTargetAtTime(g.holdBase, t + 0.12 * strength, 0.14);
    g.mix.gain.setTargetAtTime(0.6, t, 0.01);
    g.mix.gain.setTargetAtTime(g.holdBase < 20000 ? 0.85 : 1, t + 0.1, 0.12);
  }
  // 阵亡：整体慢慢“断电”
  function powerDown() {
    const g = A.g;
    if (!A.enabled) return;
    const t = g.ctx.currentTime;
    g.holdLP.frequency.cancelScheduledValues(t);
    g.holdLP.frequency.setValueAtTime(g.holdLP.frequency.value, t);
    g.holdLP.frequency.exponentialRampToValueAtTime(120, t + 2.2);
    g.mix.gain.setTargetAtTime(0, t + 1.2, 0.5);
  }
  function resetMix() {
    const g = A.g;
    if (!A.enabled) return;
    const t = g.ctx.currentTime;
    g.holdLP.frequency.cancelScheduledValues(t);
    g.mix.gain.cancelScheduledValues(t);
    g.holdBase = 20000;
    g.holdLP.frequency.setTargetAtTime(20000, t, 0.05);
    g.holdLP.Q.setTargetAtTime(0.7, t, 0.05);
    g.mix.gain.setTargetAtTime(1, t, 0.05);
    g.duck.gain.cancelScheduledValues(t);
    g.duck.gain.setTargetAtTime(1, t, 0.02);
    g.duckPad.gain.cancelScheduledValues(t);
    g.duckPad.gain.setTargetAtTime(1, t, 0.02);
  }
  // 整首歌的音量包络（片头淡入、尾声淡出用）
  function musicFade(target, time) {
    const g = A.g;
    if (!A.enabled) return;
    const t = g.ctx.currentTime;
    g.mix.gain.setTargetAtTime(target, t, time / 3);
  }

  function spectrum() {
    const g = A.live;
    if (!g || !g.analyser || !A.enabled) return null;
    g.analyser.getByteFrequencyData(g.freq);
    return g.freq;
  }

  return {
    A, Clock, buildGraph, init, useVirtual, resume, suspend, setVolumes, setStyle, applyFx,
    duck, setHold, hitDip, powerDown, resetMix, musicFade, spectrum,
    get ctx() { return A.ctx; },
    get g() { return A.g; },
    get on() { return A.enabled; },
  };
})();
