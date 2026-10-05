'use strict';
// 离线渲染：用 OfflineAudioContext 把一段（或整张唱片）渲染成音频。
// 用途：唱片导出 WAV；开发时检查混音电平（?mixtest）。

const Offline = (() => {
  // 渲染期间临时把引擎和音序器切到离线图上，完成后恢复
  async function render(o) {
    const style = o.style;
    const sr = o.sampleRate || 44100;
    const barDur = 240 / style.bpm;
    const bars = o.rec ? o.rec.bars.length : o.bars || 8;
    const dur = bars * barDur + (o.tail || 2.5);
    const octx = new OfflineAudioContext(2, Math.ceil(dur * sr), sr);
    const A = AE.A;
    const saved = { ctx: A.ctx, g: A.g, enabled: A.enabled, mode: AE.Clock.mode, vt: AE.Clock.vt, fxLv: A.fxLv, style: A.style, seq: snapshotSeq() };
    try {
      const g = AE.buildGraph(octx);
      A.ctx = octx;
      A.g = g;
      A.enabled = true;
      AE.Clock.mode = 'virtual';
      AE.Clock.vt = 0;
      AE.setStyle(style);
      AE.applyFx((o.arr && o.arr.fx) || {}, 0.01, 0);
      Seq.start(style, {
        mode: 'game', arr: o.arr || (o.rec && o.rec.changes[0].arr), startBar: o.rec ? o.rec.bars[0] : o.startBar || 0,
        delay: 0.05, rec: o.rec ? { bars: o.rec.bars, changes: o.rec.changes } : null, noBacking: o.noBacking,
      });
      const stepEnd = bars * barDur;
      let t = 0;
      while (t < stepEnd && Seq.S.running && !Seq.S.ended) {
        t += 0.1;
        AE.Clock.vt = t;
        Seq.tick();
        Seq.S.events.length = 0;
        Seq.S.evHead = 0;
        if (!o.rec && Seq.S.musicStep >= bars * 16) break;
      }
      Seq.stop();
    } finally {
      A.ctx = saved.ctx;
      A.g = saved.g;
      A.enabled = saved.enabled;
      AE.Clock.mode = saved.mode;
      AE.Clock.vt = saved.vt;
      A.fxLv = saved.fxLv;
      A.style = saved.style;
      restoreSeq(saved.seq);
    }
    if (o.onProgress) {
      for (let s = 10; s < dur; s += 10) {
        octx.suspend(s).then(() => { o.onProgress(s / dur); octx.resume(); });
      }
    }
    return octx.startRendering();
  }

  function snapshotSeq() {
    const S = Seq.S;
    const keys = ['running', 'mode', 'style', 'bpm', 't0', 'nextT', 'bar', 'pos', 'musicStep', 'songSteps', 'holding', 'resumeT', 'preview', 'arr', 'events', 'evHead', 'flags', 'ended', 'arpCount', 'stabCount', 'padVoice', 'seed', 'barLog', 'rec', 'recIdx', 'recIdx2', 'noBacking'];
    const o = {};
    for (const k of keys) o[k] = S[k];
    o.events = S.events.slice();
    o.songS = Object.assign({}, Song.S);
    return o;
  }
  function restoreSeq(o) {
    const S = Seq.S;
    for (const k in o) if (k !== 'songS') S[k] = o[k];
    Object.assign(Song.S, o.songS);
  }

  // 电平分析：峰值、RMS（dBFS），以及低 / 中 / 高三段的大致能量
  function analyze(buf) {
    const L = buf.getChannelData(0), Rr = buf.getChannelData(1);
    let peak = 0, sum = 0, clip = 0;
    for (let i = 0; i < L.length; i++) {
      const a = Math.abs(L[i]), b = Math.abs(Rr[i]);
      const m = a > b ? a : b;
      if (m > peak) peak = m;
      if (m > 0.999) clip++;
      sum += (L[i] * L[i] + Rr[i] * Rr[i]) / 2;
    }
    const rms = Math.sqrt(sum / L.length);
    // 简单分频：一阶低通 / 高通估计频段能量
    let lp = 0, hp = 0, prev = 0, eLow = 0, eHigh = 0;
    const kL = 1 - Math.exp(-TAU * 200 / buf.sampleRate);
    const kH = Math.exp(-TAU * 4000 / buf.sampleRate);
    for (let i = 0; i < L.length; i++) {
      const x = (L[i] + Rr[i]) / 2;
      lp += (x - lp) * kL;
      hp = kH * (hp + x - prev);
      prev = x;
      eLow += lp * lp;
      eHigh += hp * hp;
    }
    const db = (v) => (v > 0 ? 20 * Math.log10(v) : -120);
    return {
      peak: +db(peak).toFixed(1), rms: +db(rms).toFixed(1), clip,
      low: +db(Math.sqrt(eLow / L.length)).toFixed(1), high: +db(Math.sqrt(eHigh / L.length)).toFixed(1),
    };
  }

  // 16 位 WAV
  function toWav(buf) {
    const n = buf.length, ch = buf.numberOfChannels, sr = buf.sampleRate;
    const data = new DataView(new ArrayBuffer(44 + n * ch * 2));
    const ws = (o, s) => { for (let i = 0; i < s.length; i++) data.setUint8(o + i, s.charCodeAt(i)); };
    ws(0, 'RIFF');
    data.setUint32(4, 36 + n * ch * 2, true);
    ws(8, 'WAVE');
    ws(12, 'fmt ');
    data.setUint32(16, 16, true);
    data.setUint16(20, 1, true);
    data.setUint16(22, ch, true);
    data.setUint32(24, sr, true);
    data.setUint32(28, sr * ch * 2, true);
    data.setUint16(32, ch * 2, true);
    data.setUint16(34, 16, true);
    ws(36, 'data');
    data.setUint32(40, n * ch * 2, true);
    const chans = [];
    for (let c = 0; c < ch; c++) chans.push(buf.getChannelData(c));
    let off = 44;
    for (let i = 0; i < n; i++) {
      for (let c = 0; c < ch; c++) {
        const s = Math.max(-1, Math.min(1, chans[c][i]));
        data.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
        off += 2;
      }
    }
    return new Blob([data.buffer], { type: 'audio/wav' });
  }

  // 开发用：各乐器独奏 + 满编的电平表
  async function mixTest(styleId = 'house', sectionStart) {
    const style = STYLES[styleId];
    Song.build(style);
    const bar = sectionStart !== undefined ? sectionStart : Song.byId('drop1').start + 4;
    const out = {};
    const fullInst = {};
    INST_ORDER.forEach((id) => { fullInst[id] = 6; });
    for (const id of INST_ORDER) {
      const buf = await render({ style, arr: { inst: { [id]: 6 }, fx: {}, remix: {}, groove: 0 }, startBar: bar, bars: 4, noBacking: true, tail: 1 });
      out[id] = analyze(buf);
    }
    out.backing = analyze(await render({ style, arr: { inst: {}, fx: {}, remix: {}, groove: 3 }, startBar: bar, bars: 4, tail: 1 }));
    out.full6 = analyze(await render({ style, arr: { inst: { kick: 6, hat: 6, arp: 6, bass: 6, pad: 6, snare: 6 }, fx: { reverb: 3, delay: 3 }, remix: {}, groove: 3 }, startBar: bar, bars: 4, tail: 1 }));
    out.fullAll = analyze(await render({ style, arr: { inst: fullInst, fx: { overdrive: 5, reverb: 5, delay: 5, chorus: 5 }, remix: {}, groove: 3 }, startBar: bar, bars: 4, tail: 1 }));
    return out;
  }

  return { render, analyze, toWav, mixTest };
})();
