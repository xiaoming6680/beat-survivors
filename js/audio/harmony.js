'use strict';
// 和声：音高换算、和弦、音阶、声部进行。
// 原则：任何时刻发声的音都来自“当前和弦音 ∪ 本调五声音阶”，所以怎么叠都不难听。

const Harmony = (() => {
  const QUAL = {
    m: [0, 3, 7],
    M: [0, 4, 7],
    m7: [0, 3, 7, 10],
    M7: [0, 4, 7, 11],
    d7: [0, 4, 7, 10],
    m9: [0, 3, 7, 10, 14],
    M9: [0, 4, 7, 11, 14],
    sus2: [0, 2, 7],
    sus4: [0, 5, 7],
    add9: [0, 4, 7, 14],
    madd9: [0, 3, 7, 14],
  };
  const SCALES = {
    minor: [0, 2, 3, 5, 7, 8, 10],
    major: [0, 2, 4, 5, 7, 9, 11],
    dorian: [0, 2, 3, 5, 7, 9, 10],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    phrygian: [0, 1, 3, 5, 7, 8, 10],
  };
  // 五声音阶：小调系用小五声，大调系用大五声
  const PENTA = {
    minor: [0, 3, 5, 7, 10],
    dorian: [0, 3, 5, 7, 10],
    phrygian: [0, 3, 5, 7, 10],
    major: [0, 2, 4, 7, 9],
    mixolydian: [0, 2, 4, 7, 9],
  };

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const MODE_CN = { minor: '小调', major: '大调', dorian: '多利亚', mixolydian: '混合利底亚', phrygian: '弗里几亚' };

  // 和弦：{ pc: 根音音级, q: 品质, tones: 音级数组（含 >12 的延伸音） }
  function chord(keyRoot, deg, q) {
    const pc = (((keyRoot + deg) % 12) + 12) % 12;
    return { pc, q, iv: QUAL[q] };
  }
  function chordName(c) {
    const suffix = { m: 'm', M: '', m7: 'm7', M7: 'maj7', d7: '7', m9: 'm9', M9: 'maj9', sus2: 'sus2', sus4: 'sus4', add9: 'add9', madd9: 'm(add9)' }[c.q];
    return NAMES[c.pc] + suffix;
  }
  // 和弦在某个音区里的所有音（升序）
  function chordNotesInRange(c, lo, hi) {
    const pcs = c.iv.map((i) => (c.pc + i) % 12);
    const out = [];
    for (let m = lo; m <= hi; m++) if (pcs.includes(((m % 12) + 12) % 12)) out.push(m);
    return out;
  }
  // 根音放进指定音区 [lo, lo+12)
  function rootIn(c, lo) {
    let m = lo + ((c.pc - lo) % 12 + 12) % 12;
    return m;
  }
  // 琶音音列：从 lo 起 octaves 个八度的和弦音
  function arpNotes(c, lo, octaves) {
    return chordNotesInRange(c, lo, lo + 12 * octaves - 1);
  }
  // Pad 声部进行：选离上一组最近的转位
  function voice(c, prev, lo = 52, hi = 72) {
    const pool = chordNotesInRange(c, lo, hi);
    const n = Math.min(4, Math.max(3, c.iv.length));
    if (!prev || !prev.length) {
      // 初始：从中间音区取连续 n 个
      const mid = pool.findIndex((m) => m >= 57);
      const start = Math.max(0, Math.min(pool.length - n, mid < 0 ? 0 : mid - 1));
      return pool.slice(start, start + n);
    }
    let best = null, bestCost = 1e9;
    for (let s = 0; s + n <= pool.length; s++) {
      const cand = pool.slice(s, s + n);
      let cost = 0;
      for (let i = 0; i < n; i++) cost += Math.abs(cand[i] - (prev[i] !== undefined ? prev[i] : prev[prev.length - 1]));
      if (cost < bestCost) { bestCost = cost; best = cand; }
    }
    return best;
  }
  // 五声音阶在音区内的音
  function pentaNotes(keyRoot, mode, lo, hi) {
    const iv = PENTA[mode] || PENTA.minor;
    const pcs = iv.map((i) => (keyRoot + i) % 12);
    const out = [];
    for (let m = lo; m <= hi; m++) if (pcs.includes(((m % 12) + 12) % 12)) out.push(m);
    return out;
  }
  function keyName(keyRoot, mode) {
    return `${NAMES[((keyRoot % 12) + 12) % 12]} ${MODE_CN[mode] || mode}`;
  }

  return { QUAL, SCALES, PENTA, mtof, chord, chordName, chordNotesInRange, rootIn, arpNotes, voice, pentaNotes, keyName, NAMES };
})();
